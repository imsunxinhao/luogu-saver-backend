import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth.js';
import { validateObjectId } from '../middleware/validation.js';
import { Paste } from '../models/Paste.js';
import { Task } from '../models/Task.js';
import { crawlerService } from '../services/CrawlerService.js';
import { MemoryTaskQueue } from '../services/MemoryTaskQueue.js';

const router = Router();

/**
 * 获取最近的剪切板列表
 * GET /api/pastes/recent
 */
router.get('/recent', [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('限制必须是1-100之间的整数'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const pastes = await Paste.findRecent(limit);
    res.json({
      success: true,
      data: pastes
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 根据ID获取剪切板详情
 * GET /api/pastes/:id
 */
router.get('/:id', [
  param('id').isLength({ min: 1 }).withMessage('剪切板ID不能为空'),
], validateObjectId, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    // 验证ID格式（8位字符）
    if (!id) {
      return res.status(400).json({
        success: false,
        message: '剪切板ID不能为空'
      });
    }
    
    if (id.length !== 8) {
      return res.status(400).json({
        success: false,
        message: '剪切板ID必须是8位字符'
      });
    }
    
    const paste = await Paste.findByLuoguId(id);
    
    if (!paste) {
      return res.status(404).json({
        success: false,
        message: '剪切板不存在'
      });
    }
    
    // 增加浏览量
    await paste.incrementViewCount();
    
    return res.json({
      success: true,
      data: paste
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * 保存剪切板（添加到任务队列）
 * POST /api/pastes/save
 */
router.post('/save', [
  body('pasteId').isLength({ min: 8, max: 8 }).withMessage('剪切板ID必须是8位字符'),
  body('cookie').optional().isString().withMessage('Cookie必须是字符串'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pasteId, cookie } = req.body;
    
    // 检查是否已存在相同任务
    const existingTask = await Task.findOne({
      'payload.pasteId': pasteId,
      status: { $in: ['pending', 'processing'] }
    });
    
    if (existingTask) {
      return res.json({
        success: true,
        message: '任务已在队列中',
        data: {
          taskId: existingTask._id
        }
      });
    }
    
    // 创建新的爬取任务
    const task = new Task({
      type: 'paste_save',
      payload: {
        pasteId,
        cookie,
        userId: 'anonymous' // 默认用户ID
      },
      status: 'pending',
      priority: 'normal' // 默认优先级
    });
    
    await task.save();
    
    // 添加到任务队列
    const taskQueueService = (req.app as any).taskQueueService as MemoryTaskQueue;
    await taskQueueService.addTask('paste_save', { pasteId, cookie });
    
    return res.status(201).json({
      success: true,
      message: '已添加到保存队列',
      data: {
        taskId: task._id
      }
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * 直接保存剪切板（立即执行）
 * POST /api/pastes/save-direct
 */
router.post('/save-direct', [
  body('pasteId').isLength({ min: 8, max: 8 }).withMessage('剪切板ID必须是8位字符'),
  body('cookie').optional().isString().withMessage('Cookie必须是字符串'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pasteId, cookie } = req.body;
    
    // 使用默认Cookie或用户提供的Cookie
    const defaultCookie = '__client_id=5b60b2b100b2103268e371741f14659c0e32e83e; _uid=1188071; C3VK=34cc71';
    const finalCookie = cookie || defaultCookie;
    
    // 直接爬取并保存剪切板
    const result = await crawlerService.savePasteDirectly(pasteId, finalCookie);
    
    if (result.success) {
      return res.json({
        success: true,
        message: '剪切板保存成功',
        data: result.data
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    return next(error);
  }
});

/**
 * 公开保存剪切板（无需登录）
 * POST /api/pastes/save-public
 */
router.post('/save-public', [
  body('pasteId').isLength({ min: 8, max: 8 }).withMessage('剪切板ID必须是8位字符'),
  body('cookie').optional().isString().withMessage('Cookie必须是字符串'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pasteId, cookie } = req.body;
    
    // 使用默认Cookie或用户提供的Cookie
    const defaultCookie = '__client_id=5b60b2b100b2103268e371741f14659c0e32e83e; _uid=1188071; C3VK=34cc71';
    const finalCookie = cookie || defaultCookie;
    
    // 检查是否已存在
    const existingPaste = await Paste.findOne({ luoguId: pasteId });
    if (existingPaste) {
      return res.json({
        success: true,
        message: '剪切板已存在',
        data: existingPaste
      });
    }
    
    // 直接爬取并保存剪切板
    const result = await crawlerService.savePasteDirectly(pasteId, finalCookie);
    
    if (result.success) {
      return res.json({
        success: true,
        message: '剪切板保存成功',
        data: result.data
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    return next(error);
  }
});

/**
 * 获取剪切板列表（支持分页和筛选）
 * GET /api/pastes
 */
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是正整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页数量必须是1-100之间的整数'),
  query('authorUid').optional().isString().withMessage('作者UID必须是字符串'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt((req.query.page as string) || '1') || 1;
    const limit = parseInt((req.query.limit as string) || '20') || 20;
    const authorUid = req.query.authorUid as string | undefined;
    
    const skip = (page - 1) * limit;
    
    // 构建查询条件
    const query: any = {
      status: 'completed',
      isPublic: true
    };
    
    if (authorUid) {
      query.authorUid = authorUid;
    }
    
    // 获取总数
    const total = await Paste.countDocuments(query);
    
    // 获取数据
    const pastes = await Paste.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
    
    return res.json({
      success: true,
      data: pastes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * 搜索剪切板
 * GET /api/pastes/search
 */
router.get('/search', [
  query('q').notEmpty().withMessage('搜索关键词不能为空'),
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是正整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页数量必须是1-100之间的整数'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keyword = (req.query.q as string) || '';
    
    // 检查关键词是否为空
    if (!keyword.trim()) {
      return res.status(400).json({
        success: false,
        message: '搜索关键词不能为空'
      });
    }
    
    const page = parseInt((req.query.page as string) || '1') || 1;
    const limit = parseInt((req.query.limit as string) || '20') || 20;
    
    const skip = (page - 1) * limit;
    
    // 构建搜索查询
    const query: any = {
      status: 'completed',
      isPublic: true,
      $or: [
        { title: { $regex: keyword, $options: 'i' } },
        { content: { $regex: keyword, $options: 'i' } },
        { authorName: { $regex: keyword, $options: 'i' } },
        { category: { $regex: keyword, $options: 'i' } }
      ]
    };
    
    // 获取总数
    const total = await Paste.countDocuments(query);
    
    // 获取数据
    const pastes = await Paste.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
    
    return res.json({
      success: true,
      data: pastes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * 根据作者获取剪切板列表
 * GET /api/pastes/author/:uid
 */
router.get('/author/:uid', [
  param('uid').notEmpty().withMessage('作者UID不能为空'),
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是正整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页数量必须是1-100之间的整数'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uid } = req.params;
    
    // 确保 uid 存在
    if (!uid) {
      return res.status(400).json({
        success: false,
        message: '作者UID不能为空'
      });
    }
    
    const page = parseInt((req.query.page as string) || '1') || 1;
    const limit = parseInt((req.query.limit as string) || '20') || 20;
    
    const pastes = await Paste.findByAuthor(uid, page, limit);
    
    // 获取总数
    const total = await Paste.countDocuments({
      authorUid: uid,
      status: 'completed',
      isPublic: true
    });
    
    return res.json({
      success: true,
      data: pastes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * 删除剪切板（需要管理员权限）
 * DELETE /api/pastes/:id
 */
router.delete('/:id', authenticateToken, [
  param('id').isLength({ min: 1 }).withMessage('剪切板ID不能为空'),
], validateObjectId, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    // 验证ID格式（8位字符）
    if (!id) {
      return res.status(400).json({
        success: false,
        message: '剪切板ID不能为空'
      });
    }
    
    if (id.length !== 8) {
      return res.status(400).json({
        success: false,
        message: '剪切板ID必须是8位字符'
      });
    }
    
    // 检查用户权限（只有管理员可以删除）
    const user = (req as any).user;
    if (!user || !user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: '无权删除剪切板'
      });
    }
    
    const paste = await Paste.findByLuoguId(id);
    
    if (!paste) {
      return res.status(404).json({
        success: false,
        message: '剪切板不存在'
      });
    }
    
    await Paste.deleteOne({ luoguId: id });
    
    return res.json({
      success: true,
      message: '剪切板删除成功'
    });
  } catch (error) {
    return next(error);
  }
});

export default router;