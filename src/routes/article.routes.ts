import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { Article } from '../models/Article.js';
import { Task } from '../models/Task.js';
import { crawlerService } from '../services/CrawlerService.js';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// 获取最近文章
router.get('/recent', [
  param('limit').optional().isInt({ min: 1, max: 100 }).withMessage('限制数量必须在1-100之间')
], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: errors.array()
      });
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const articles = await Article.findRecent(limit);

    res.json({
      success: true,
      data: articles,
      count: articles.length
    });

  } catch (error: any) {
    logger.error('获取最近文章失败:', error);
    res.status(500).json({
      success: false,
      message: '获取文章列表失败',
      error: error.message
    });
  }
});

// 获取文章详情
router.get('/:id', [
  param('id').isLength({ min: 8, max: 8 }).withMessage('文章ID必须是8位字符')
], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    
    // 通过洛谷ID查找文章
    const article = await Article.findByLuoguId(id);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: '文章不存在'
      });
    }

    // 增加查看计数
    await article.incrementViewCount();

    res.json({
      success: true,
      data: article
    });

  } catch (error: any) {
    logger.error('获取文章详情失败:', error);
    res.status(500).json({
      success: false,
      message: '获取文章详情失败',
      error: error.message
    });
  }
});

// 保存文章（队列方式）
router.post('/save', authenticateToken, [
  body('articleId').isLength({ min: 8, max: 8 }).withMessage('文章ID必须是8位字符'),
  body('cookie').optional().isString().withMessage('Cookie必须是字符串')
], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: errors.array()
      });
    }

    const { articleId, cookie } = req.body;
    const userId = req.user?.userId;

    // 检查文章是否已存在
    const existingArticle = await Article.findByLuoguId(articleId);
    if (existingArticle) {
      return res.json({
        success: true,
        message: '文章已存在',
        data: existingArticle
      });
    }

    // 创建保存任务
    const task = new Task({
      type: 'article_save',
      payload: {
        articleId,
        cookie,
        url: `https://www.luogu.com/article/${articleId}`
      },
      createdBy: userId,
      priority: 'normal'
    });

    await task.save();

    res.json({
      success: true,
      message: '保存任务已创建',
      data: {
        taskId: task._id,
        status: task.status
      }
    });

  } catch (error: any) {
    logger.error('创建保存任务失败:', error);
    res.status(500).json({
      success: false,
      message: '创建保存任务失败',
      error: error.message
    });
  }
});

// 直接保存文章（立即执行）
router.post('/save-direct', authenticateToken, [
  body('articleId').isLength({ min: 8, max: 8 }).withMessage('文章ID必须是8位字符'),
  body('cookie').optional().isString().withMessage('Cookie必须是字符串')
], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: errors.array()
      });
    }

    const { articleId, cookie } = req.body;

    const result = await crawlerService.saveArticleDirectly(articleId, cookie);

    if (result.success) {
      // 将Mongoose文档转换为普通对象，避免循环引用
      const responseData = result.data ? result.data.toObject ? result.data.toObject() : result.data : null;
      
      res.json({
        success: true,
        message: result.message,
        data: responseData
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error: any) {
    logger.error('直接保存文章失败:', error);
    res.status(500).json({
      success: false,
      message: '保存文章失败',
      error: error.message
    });
  }
});

// 无需登录直接保存文章（公开接口）
router.post('/save-public', [
  body('articleId').isLength({ min: 8, max: 8 }).withMessage('文章ID必须是8位字符'),
  body('cookie').optional().isString().withMessage('Cookie必须是字符串')
], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: errors.array()
      });
    }

    const { articleId, cookie } = req.body;

    // 使用默认Cookie或用户提供的Cookie
    const defaultCookie = '__client_id=5b60b2b100b2103268e371741f14659c0e32e83e; _uid=1188071; C3VK=34cc71';
    const finalCookie = cookie || defaultCookie;

    // 检查文章是否已存在（公开文章）
    const existingArticle = await Article.findByLuoguId(articleId);
    if (existingArticle && existingArticle.isPublic) {
      return res.json({
        success: true,
        message: '文章已存在',
        data: existingArticle
      });
    }

    const result = await crawlerService.saveArticleDirectly(articleId, finalCookie);

    if (result.success) {
      // 将保存的文章标记为公开
      if (result.data && result.data._id) {
        await Article.findByIdAndUpdate(result.data._id, { 
          isPublic: true,
          createdBy: null // 匿名用户
        });
      }
      
      // 将Mongoose文档转换为普通对象，避免循环引用
      const responseData = result.data ? result.data.toObject ? result.data.toObject() : result.data : null;
      
      res.json({
        success: true,
        message: result.message,
        data: responseData
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error: any) {
    logger.error('公开保存文章失败:', error);
    res.status(500).json({
      success: false,
      message: '保存文章失败',
      error: error.message
    });
  }
});

// 搜索文章
router.get('/search', [
  body('query').optional().isString().withMessage('搜索关键词必须是字符串'),
  body('author').optional().isString().withMessage('作者ID必须是字符串'),
  body('category').optional().isString().withMessage('分类必须是字符串'),
  body('tags').optional().isArray().withMessage('标签必须是数组'),
  body('page').optional().isInt({ min: 1 }).withMessage('页码必须是正整数'),
  body('limit').optional().isInt({ min: 1, max: 100 }).withMessage('限制数量必须在1-100之间')
], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: errors.array()
      });
    }

    const { query, author, category, tags, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const filter: any = { status: 'completed', isPublic: true };

    if (query) {
      filter.$or = [
        { title: { $regex: query, $options: 'i' } },
        { content: { $regex: query, $options: 'i' } }
      ];
    }

    if (author) {
      filter.authorUid = author;
    }

    if (category) {
      filter.category = category;
    }

    if (tags && Array.isArray(tags)) {
      filter.tags = { $in: tags };
    }

    const [articles, total] = await Promise.all([
      Article.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit as string))
        .exec(),
      Article.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: articles,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });

  } catch (error: any) {
    logger.error('搜索文章失败:', error);
    res.status(500).json({
      success: false,
      message: '搜索文章失败',
      error: error.message
    });
  }
});

// 获取作者的文章列表
router.get('/author/:authorId', [
  param('authorId').isString().withMessage('作者ID必须是字符串'),
  body('page').optional().isInt({ min: 1 }).withMessage('页码必须是正整数'),
  body('limit').optional().isInt({ min: 1, max: 100 }).withMessage('限制数量必须在1-100之间')
], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: errors.array()
      });
    }

    const { authorId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const articles = await Article.findByAuthor(authorId, page, limit);
    const total = await Article.countDocuments({ 
      authorUid: authorId, 
      status: 'completed', 
      isPublic: true 
    });

    res.json({
      success: true,
      data: articles,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error: any) {
    logger.error('获取作者文章列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取作者文章列表失败',
      error: error.message
    });
  }
});

// 删除文章（仅管理员）
router.delete('/:id', authenticateToken, [
  param('id').isLength({ min: 8, max: 8 }).withMessage('文章ID必须是8位字符')
], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const user = req.user;

    // 检查权限（仅管理员可删除）
    if (user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '权限不足'
      });
    }

    const article = await Article.findByLuoguId(id);
    if (!article) {
      return res.status(404).json({
        success: false,
        message: '文章不存在'
      });
    }

    await Article.deleteOne({ luoguId: id });

    res.json({
      success: true,
      message: '文章删除成功'
    });

  } catch (error: any) {
    logger.error('删除文章失败:', error);
    res.status(500).json({
      success: false,
      message: '删除文章失败',
      error: error.message
    });
  }
});

export default router;