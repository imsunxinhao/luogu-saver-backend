import express from 'express';
import { User } from '../models/User.js';
import { Article } from '../models/Article.js';
import { Task } from '../models/Task.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// 获取用户列表（仅管理员）
router.get('/', authenticateToken, requireRole(['admin']), asyncHandler(async (req: any, res: any) => {
  const { 
    page = 1, 
    limit = 20, 
    search, 
    role, 
    isActive 
  } = req.query;

  const filter: any = {};
  
  if (search) {
    filter.$or = [
      { username: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { 'profile.displayName': { $regex: search, $options: 'i' } }
    ];
  }
  
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('-password') // 排除密码字段
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    User.countDocuments(filter)
  ]);

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

// 获取用户详情
router.get('/:userId', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { userId } = req.params;
  
  // 普通用户只能查看自己的信息，管理员可以查看所有用户
  if (req.user.role !== 'admin' && req.user.userId !== userId) {
    return res.status(403).json({
      success: false,
      message: '权限不足'
    });
  }

  const user = await User.findById(userId).select('-password');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: '用户未找到'
    });
  }

  res.json({
    success: true,
    data: { user }
  });
}));

// 更新用户状态（仅管理员）
router.put('/:userId/status', authenticateToken, requireRole(['admin']), asyncHandler(async (req: any, res: any) => {
  const { userId } = req.params;
  const { isActive } = req.body;

  if (isActive === undefined) {
    return res.status(400).json({
      success: false,
      message: 'isActive 字段为必填项'
    });
  }

  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: '用户未找到'
    });
  }

  // 不能禁用自己
  if (user._id.toString() === req.user.userId && !isActive) {
    return res.status(400).json({
      success: false,
      message: '不能禁用自己的账户'
    });
  }

  user.isActive = isActive;
  await user.save();

  logger.info(`用户状态更新: ${user.username} -> ${isActive ? '启用' : '禁用'}, 操作者: ${req.user.username}`);

  res.json({
    success: true,
    message: `用户已${isActive ? '启用' : '禁用'}`,
    data: { user: user.toObject() }
  });
}));

// 更新用户角色（仅管理员）
router.put('/:userId/role', authenticateToken, requireRole(['admin']), asyncHandler(async (req: any, res: any) => {
  const { userId } = req.params;
  const { role } = req.body;

  if (!role || !['user', 'admin'].includes(role)) {
    return res.status(400).json({
      success: false,
      message: '角色必须是 user 或 admin'
    });
  }

  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: '用户未找到'
    });
  }

  // 不能修改自己的角色
  if (user._id.toString() === req.user.userId) {
    return res.status(400).json({
      success: false,
      message: '不能修改自己的角色'
    });
  }

  user.role = role;
  await user.save();

  logger.info(`用户角色更新: ${user.username} -> ${role}, 操作者: ${req.user.username}`);

  res.json({
    success: true,
    message: '用户角色已更新',
    data: { user: user.toObject() }
  });
}));

// 获取用户统计信息
router.get('/:userId/stats', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { userId } = req.params;
  
  // 普通用户只能查看自己的统计信息，管理员可以查看所有用户
  if (req.user.role !== 'admin' && req.user.userId !== userId) {
    return res.status(403).json({
      success: false,
      message: '权限不足'
    });
  }

  const [
    totalArticles,
    totalTasks,
    completedTasks,
    failedTasks,
    user
  ] = await Promise.all([
    Article.countDocuments({ createdBy: userId }),
    Task.countDocuments({ createdBy: userId }),
    Task.countDocuments({ createdBy: userId, status: 'completed' }),
    Task.countDocuments({ createdBy: userId, status: 'failed' }),
    User.findById(userId).select('statistics')
  ]);

  const stats = {
    articles: {
      total: totalArticles
    },
    tasks: {
      total: totalTasks,
      completed: completedTasks,
      failed: failedTasks,
      successRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    },
    userStatistics: user?.statistics || {}
  };

  res.json({
    success: true,
    data: { stats }
  });
}));

// 获取用户最近的活动
router.get('/:userId/activity', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { userId } = req.params;
  const { limit = 10 } = req.query;
  
  // 权限检查
  if (req.user.role !== 'admin' && req.user.userId !== userId) {
    return res.status(403).json({
      success: false,
      message: '权限不足'
    });
  }

  const [recentArticles, recentTasks] = await Promise.all([
    Article.find({ createdBy: userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('title url status createdAt')
      .lean(),
    Task.find({ createdBy: userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('type status payload createdAt')
      .lean()
  ]);

  const activity = [
    ...recentArticles.map((article: any) => ({
      type: 'article',
      title: article.title,
      url: article.url,
      status: article.status,
      createdAt: article.createdAt
    })),
    ...recentTasks.map((task: any) => ({
      type: 'task',
      taskType: task.type,
      status: task.status,
      payload: task.payload,
      createdAt: task.createdAt
    }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
   .slice(0, parseInt(limit));

  res.json({
    success: true,
    data: { activity }
  });
}));

// 删除用户（仅管理员）
router.delete('/:userId', authenticateToken, requireRole(['admin']), asyncHandler(async (req: any, res: any) => {
  const { userId } = req.params;

  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: '用户未找到'
    });
  }

  // 不能删除自己
  if (user._id.toString() === req.user.userId) {
    return res.status(400).json({
      success: false,
      message: '不能删除自己的账户'
    });
  }

  // 检查用户是否有相关数据
  const [articleCount, taskCount] = await Promise.all([
    Article.countDocuments({ createdBy: userId }),
    Task.countDocuments({ createdBy: userId })
  ]);

  // 软删除：标记为不活跃而不是物理删除
  user.isActive = false;
  await user.save();

  logger.info(`用户已禁用: ${user.username}, 操作者: ${req.user.username}`);

  res.json({
    success: true,
    message: '用户已禁用',
    data: {
      user: user.toObject(),
      relatedData: {
        articles: articleCount,
        tasks: taskCount
      }
    }
  });
}));

export default router;