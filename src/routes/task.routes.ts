import express from 'express';
import { MemoryTaskQueue } from '../services/MemoryTaskQueue.js';
import { Task } from '../models/Task.js';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// 获取任务列表
router.get('/', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { 
    page = 1, 
    limit = 20, 
    status, 
    type, 
    userId = req.user.userId 
  } = req.query;

  const filter: any = { createdBy: userId };
  
  if (status) filter.status = status;
  if (type) filter.type = type;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [tasks, total] = await Promise.all([
    Task.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Task.countDocuments(filter)
  ]);

  res.json({
    success: true,
    data: {
      tasks,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

// 获取任务详情
router.get('/:taskId', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { taskId } = req.params;

  const task = await Task.findOne({ 
    _id: taskId, 
    createdBy: req.user.userId 
  });

  if (!task) {
    return res.status(404).json({
      success: false,
      message: '任务未找到'
    });
  }

  res.json({
    success: true,
    data: { task }
  });
}));

// 创建保存文章任务
router.post('/save-article', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { url, options = {} } = req.body;
  const userId = req.user.userId;

  if (!url) {
    return res.status(400).json({
      success: false,
      message: '文章URL为必填项'
    });
  }

  // 验证URL格式
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: '无效的URL格式'
    });
  }

  // 检查是否已有相同的任务正在处理
  const existingTask = await Task.findOne({
    'payload.url': url,
    createdBy: userId,
    status: { $in: ['pending', 'processing'] }
  });

  if (existingTask) {
    return res.status(409).json({
      success: false,
      message: '相同URL的任务正在处理中',
      data: { taskId: existingTask._id }
    });
  }

  // 获取任务队列服务实例（通过app.ts注入）
  const taskQueueService = (req.app as any).taskQueueService as MemoryTaskQueue;

  const jobId = await taskQueueService.addTask(
    'save-article',
    { url, userId, options },
    { priority: options.priority || 'normal' }
  );

  logger.info(`创建保存文章任务: ${url}, 用户ID: ${userId}, 任务ID: ${jobId}`);

  res.status(201).json({
    success: true,
    message: '任务已创建',
    data: { taskId: jobId }
  });
}));

// 批量保存文章任务
router.post('/batch-save-articles', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { urls, options = {} } = req.body;
  const userId = req.user.userId;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'URL列表不能为空'
    });
  }

  if (urls.length > 50) {
    return res.status(400).json({
      success: false,
      message: '单次批量操作最多支持50个URL'
    });
  }

  // 验证URL格式
  for (const url of urls) {
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: `无效的URL格式: ${url}`
      });
    }
  }

  // 获取任务队列服务实例
  const taskQueueService = (req.app as any).taskQueueService as MemoryTaskQueue;

  const jobId = await taskQueueService.addTask(
    'batch-save-articles',
    { urls, userId, options },
    { priority: options.priority || 'low' }
  );

  logger.info(`创建批量保存文章任务: ${urls.length}个URL, 用户ID: ${userId}, 任务ID: ${jobId}`);

  res.status(201).json({
    success: true,
    message: '批量任务已创建',
    data: { 
      taskId: jobId,
      totalUrls: urls.length 
    }
  });
}));

// 获取任务状态
router.get('/:taskId/status', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { taskId } = req.params;

  // 验证任务归属
  const task = await Task.findOne({ 
    jobId: taskId, 
    createdBy: req.user.userId 
  });

  if (!task) {
    return res.status(404).json({
      success: false,
      message: '任务未找到'
    });
  }

  // 获取任务队列服务实例
  const taskQueueService = (req.app as any).taskQueueService as MemoryTaskQueue;

  const status = await taskQueueService.getTaskStatus(taskId);

  if (!status) {
    return res.status(404).json({
      success: false,
      message: '任务状态未找到'
    });
  }

  res.json({
    success: true,
    data: { status }
  });
}));

// 获取队列统计信息
router.get('/stats/queue', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const taskQueueService = (req.app as any).taskQueueService as MemoryTaskQueue;
  
  const stats = await taskQueueService.getQueueStats();

  res.json({
    success: true,
    data: { stats }
  });
}));

// 获取用户任务统计
router.get('/stats/user', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const userId = req.user.userId;

  const stats = await Task.aggregate([
    { $match: { createdBy: userId } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const totalTasks = await Task.countDocuments({ createdBy: userId });
  const todayTasks = await Task.countDocuments({
    createdBy: userId,
    createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
  });

  const result = {
    total: totalTasks,
    today: todayTasks,
    byStatus: {} as Record<string, number>
  };

  stats.forEach(stat => {
    result.byStatus[stat._id as string] = stat.count;
  });

  res.json({
    success: true,
    data: { stats: result }
  });
}));

// 取消任务
router.delete('/:taskId/cancel', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { taskId } = req.params;

  // 验证任务归属和状态
  const task = await Task.findOne({ 
    jobId: taskId, 
    createdBy: req.user.userId,
    status: { $in: ['pending', 'processing'] }
  });

  if (!task) {
    return res.status(404).json({
      success: false,
      message: '任务未找到或无法取消'
    });
  }

  // 获取任务队列服务实例
  const taskQueueService = (req.app as any).taskQueueService as MemoryTaskQueue;
  
  // 尝试取消任务
  const cancelled = await taskQueueService.cancelTask(taskId);
  if (!cancelled) {
    return res.status(400).json({
      success: false,
      message: '任务正在处理中，无法取消'
    });
  }

  // 更新任务状态
  task.status = 'cancelled';
  task.cancelledAt = new Date();
  await task.save();

  logger.info(`任务已取消: ${taskId}, 用户ID: ${req.user.userId}`);

  res.json({
    success: true,
    message: '任务已取消'
  });
}));

export default router;