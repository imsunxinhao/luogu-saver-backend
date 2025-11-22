import { EventEmitter } from 'events';
import { Task } from '../models/Task.js';
import { CrawlerService } from './CrawlerService.js';
import { logger } from '../utils/logger.js';

interface TaskJob {
  id: string;
  type: string;
  payload: any;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  result?: any;
  error?: any;
  attempts: number;
  maxAttempts: number;
}

export class MemoryTaskQueue extends EventEmitter {
  private queue: TaskJob[] = [];
  private processing: Set<string> = new Set();
  private concurrency: number;
  private crawlerService: CrawlerService;
  private isRunning = false;

  constructor(concurrency: number = 3) {
    super();
    this.concurrency = concurrency;
    this.crawlerService = new CrawlerService();
  }

  async initialize(): Promise<void> {
    // 启动队列处理器
    await this.start();
    
    // 加载待处理的任务到队列中
    await this.loadPendingTasks();
  }

  private async loadPendingTasks(): Promise<void> {
    try {
      const pendingTasks = await Task.find({ 
        status: 'pending',
        type: { $in: ['paste_save', 'article_save'] }
      }).sort({ createdAt: 1 }).limit(100);
      
      for (const task of pendingTasks) {
        // 使用数据库中的jobId，如果不存在则使用数据库ID
        const jobId = task.jobId || (task._id as any).toString();
        
        const job: TaskJob = {
          id: jobId,
          type: task.type,
          payload: task.payload,
          status: 'pending',
          progress: task.progress || 0,
          createdAt: task.createdAt,
          attempts: task.attempts || 0,
          maxAttempts: task.maxAttempts || 3
        };
        
        this.queue.push(job);
      }
      
      logger.info(`已加载 ${pendingTasks.length} 个待处理任务到队列中`);
    } catch (error) {
      logger.error('加载待处理任务失败:', error);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('内存任务队列已启动');
    
    // 启动队列处理器
    this.processQueue();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('内存任务队列已停止');
  }

  async close(): Promise<void> {
    await this.stop();
    logger.info('内存任务队列已关闭');
  }

  private async processQueue(): Promise<void> {
    while (this.isRunning) {
      if (this.processing.size < this.concurrency && this.queue.length > 0) {
        const job = this.queue.shift();
        if (job && job.status === 'pending') {
          this.processing.add(job.id);
          this.processJob(job).catch(error => {
            logger.error(`任务处理失败: ${job.id}`, error);
          });
        }
      }
      
      // 短暂休眠，避免CPU占用过高
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async processJob(job: TaskJob): Promise<void> {
    try {
      // 更新任务状态为处理中
      job.status = 'processing';
      job.startedAt = new Date();
      job.progress = 10;
      
      this.emit('jobStarted', job);
      
      let result;
      
      switch (job.type) {
        case 'article_save':
          result = await this.processSaveArticle(job);
          break;
        case 'paste_save':
          result = await this.processSavePaste(job);
          break;
        case 'batch_process':
          result = await this.processBatchSaveArticles(job);
          break;
        case 'cleanup':
          result = await this.processCleanupTasks(job);
          break;
        default:
          throw new Error(`未知的任务类型: ${job.type}`);
      }
      
      // 更新任务状态为完成
      job.status = 'completed';
      job.progress = 100;
      job.completedAt = new Date();
      job.result = result;
      
      this.emit('jobCompleted', job);
      
    } catch (error) {
      job.attempts++;
      
      if (job.attempts >= job.maxAttempts) {
        // 达到最大重试次数，标记为失败
        job.status = 'failed';
        job.failedAt = new Date();
        job.error = {
          message: (error as Error).message,
          stack: (error as Error).stack
        };
        
        this.emit('jobFailed', job);
        
        // 立即更新数据库状态
        await this.updateTaskInDatabase(job);
      } else {
        // 重新加入队列等待重试
        job.status = 'pending';
        job.progress = 0;
        
        // 增加重试间隔，避免过于频繁的重试
        const delay = Math.min(5000 * Math.pow(2, job.attempts), 60000); // 最小5秒，最大60秒
        
        // 检查是否已经有相同的任务在队列中
        const existingJob = this.queue.find(j => 
          j.type === job.type && 
          JSON.stringify(j.payload) === JSON.stringify(job.payload)
        );
        
        if (!existingJob) {
          // 先更新数据库状态为pending
          await this.updateTaskInDatabase(job);
          
          setTimeout(() => {
            this.queue.unshift(job);
          }, delay);
          
          logger.info(`任务 ${job.id} 将在 ${delay}ms 后重试，当前尝试次数: ${job.attempts}`);
          this.emit('jobRetry', job);
        } else {
          logger.info(`任务 ${job.id} 已存在相同任务在队列中，跳过重试`);
          
          // 更新数据库状态为pending
          await this.updateTaskInDatabase(job);
        }
      }
    } finally {
      this.processing.delete(job.id);
      
      // 只有在任务完成或失败时才更新数据库状态
      // 重试的任务已经在catch块中更新了状态
      if (job.status === 'completed' || job.status === 'failed') {
        await this.updateTaskInDatabase(job);
      }
    }
  }

  private async processSaveArticle(job: TaskJob): Promise<any> {
    const { url, userId, options } = job.payload;
    
    logger.info(`开始保存文章: ${url}, 用户ID: ${userId}`);
    
    // 更新进度
    job.progress = 30;
    
    // 调用爬虫服务保存文章
    const result = await this.crawlerService.saveArticleDirectly(url, options?.cookie);
    
    if (!result.success) {
      throw new Error(result.message || '保存文章失败');
    }
    
    // 更新进度
    job.progress = 100;
    
    return {
      articleId: result.data._id,
      title: result.data.title,
      url: result.data.url,
      status: result.data.status
    };
  }

  private async processSavePaste(job: TaskJob): Promise<any> {
    let pasteId: string;
    const { url, userId, options } = job.payload;
    
    // 从URL中提取pasteId，或者直接使用pasteId字段
    if (url && url.includes('luogu.com/paste/')) {
      pasteId = url.split('/paste/')[1];
    } else if (job.payload.pasteId) {
      pasteId = job.payload.pasteId;
    } else {
      throw new Error('无法从任务载荷中提取剪切板ID');
    }
    
    logger.info(`开始保存剪切板: ${pasteId}, 用户ID: ${userId}`);
    
    // 更新进度
    job.progress = 30;
    
    // 调用爬虫服务保存剪切板
    const result = await this.crawlerService.savePasteDirectly(pasteId, options?.cookie);
    
    if (!result.success) {
      throw new Error(result.message || '保存剪切板失败');
    }
    
    // 更新进度
    job.progress = 100;
    
    return {
      pasteId: result.data.luoguId,
      title: result.data.title,
      url: `https://www.luogu.com/paste/${pasteId}`,
      status: 'completed'
    };
  }

  private async processBatchSaveArticles(job: TaskJob): Promise<any> {
    const { urls, userId, options } = job.payload;
    const total = urls.length;
    const results = [];
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      try {
        logger.info(`批量保存文章 [${i + 1}/${total}]: ${url}`);
        
        const result = await this.crawlerService.saveArticleDirectly(url, options?.cookie);
        if (result.success) {
          results.push({
            url,
            success: true,
            articleId: result.data._id,
            title: result.data.title
          });
        } else {
          results.push({
            url,
            success: false,
            error: result.message || '保存失败'
          });
        }
      } catch (error) {
        logger.error(`批量保存文章失败 [${i + 1}/${total}]: ${url}`, error);
        results.push({
          url,
          success: false,
          error: (error as Error).message
        });
      }
      
      // 更新进度
      const progress = Math.round(((i + 1) / total) * 100);
      job.progress = progress;
      
      // 短暂延迟，避免请求过于频繁
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return {
      total,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }

  private async processCleanupTasks(job: TaskJob): Promise<any> {
    const { olderThanDays = 30 } = job.payload;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    // 删除过期的已完成任务
    const result = await Task.deleteMany({
      status: 'completed',
      completedAt: { $lt: cutoffDate }
    });
    
    logger.info(`清理任务完成: 删除了 ${result.deletedCount} 个过期任务`);
    
    return {
      deletedCount: result.deletedCount,
      cutoffDate
    };
  }

  private async updateTaskInDatabase(job: TaskJob): Promise<void> {
    try {
      // 使用任务ID或数据库ID来查找任务
      const query = job.id.startsWith('task_') ? { jobId: job.id } : { _id: job.id };
      
      await Task.findOneAndUpdate(
        query,
        {
          status: job.status,
          progress: job.progress,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          failedAt: job.failedAt,
          result: job.result,
          error: job.error,
          $inc: { retryCount: job.attempts > 1 ? 1 : 0 }
        }
      );
    } catch (error) {
      logger.error('更新数据库任务状态失败:', error);
    }
  }

  // 添加任务到队列
  async addTask(type: string, payload: any, options: any = {}): Promise<string> {
    const jobId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job: TaskJob = {
      id: jobId,
      type,
      payload,
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      attempts: 0,
      maxAttempts: options.maxAttempts || 3
    };

    // 在数据库中创建任务记录
    const task = new Task({
      jobId: job.id,
      type,
      payload,
      status: 'pending',
      priority: options.priority || 'normal',
      createdBy: payload.userId
    });

    await task.save();

    // 添加到内存队列
    this.queue.push(job);

    logger.info(`任务已添加到队列: ${jobId} - ${type}`);
    this.emit('jobAdded', job);

    return jobId;
  }

  // 获取任务状态
  async getTaskStatus(jobId: string): Promise<any> {
    // 首先在内存队列中查找
    const job = this.queue.find(j => j.id === jobId) || 
                Array.from(this.processing).map(id => 
                  this.queue.find(j => j.id === id)
                ).find(j => j?.id === jobId);

    if (!job) {
      // 如果内存中找不到，从数据库查找
      const task = await Task.findOne({ jobId });
      if (!task) return null;
      
      const taskObj = task.toObject();
      
      return {
        jobId: taskObj.jobId,
        type: taskObj.type,
        status: taskObj.status,
        progress: taskObj.progress,
        createdAt: taskObj.createdAt,
        startedAt: taskObj.startedAt,
        completedAt: taskObj.completedAt,
        failedAt: taskObj.failedAt,
        result: taskObj.result,
        error: taskObj.error
      };
    }

    return {
      jobId: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      failedAt: job.failedAt,
      result: job.result,
      error: job.error
    };
  }

  // 获取队列统计信息
  async getQueueStats(): Promise<any> {
    const waiting = this.queue.filter(job => job.status === 'pending');
    const active = Array.from(this.processing).map(id => 
      this.queue.find(job => job.id === id)
    ).filter(Boolean);
    
    // 从数据库获取已完成和失败的任务统计
    const [completedCount, failedCount] = await Promise.all([
      Task.countDocuments({ status: 'completed' }),
      Task.countDocuments({ status: 'failed' })
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completedCount,
      failed: failedCount,
      delayed: 0 // 内存队列不支持延迟任务
    };
  }

  // 取消任务
  async cancelTask(jobId: string): Promise<boolean> {
    const jobIndex = this.queue.findIndex(job => job.id === jobId && job.status === 'pending');
    
    if (jobIndex !== -1) {
      // 从队列中移除
      const job = this.queue.splice(jobIndex, 1)[0];
      if (job) {
        job.status = 'cancelled';
        
        // 更新数据库
        await Task.findOneAndUpdate(
          { jobId: jobId },
          {
            status: 'cancelled',
            cancelledAt: new Date()
          }
        );
        
        this.emit('jobCancelled', job);
        return true;
      }
    }
    
    // 如果任务正在处理中，无法取消
    if (this.processing.has(jobId)) {
      return false;
    }
    
    return false;
  }

  // 获取队列长度
  getQueueLength(): number {
    return this.queue.length;
  }

  // 获取处理中的任务数量
  getProcessingCount(): number {
    return this.processing.size;
  }
}

export default MemoryTaskQueue;