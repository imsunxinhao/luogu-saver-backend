import express from 'express';
import { Article } from '../models/Article.js';
import { User } from '../models/User.js';
import { Task } from '../models/Task.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// 获取系统统计信息
router.get('/', async (req: any, res: any) => {
  try {
    // 获取文章统计
    const totalArticles = await Article.countDocuments();
    const todayArticles = await Article.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    // 获取文章分类统计
    const articlesByCategory = await Article.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // 获取用户统计
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({
      lastLogin: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    
    // 获取任务统计
    const totalTasks = await Task.countDocuments();
    const successTasks = await Task.countDocuments({ status: 'completed' });
    
    // 获取存储统计（估算）
    const storageStats = await Article.aggregate([
      {
        $project: {
          size: { $add: [
            { $cond: { if: { $eq: [{ $type: '$title' }, 'string'] }, then: { $strLenBytes: '$title' }, else: 0 } },
            { $cond: { if: { $eq: [{ $type: '$content' }, 'string'] }, then: { $strLenBytes: '$content' }, else: 0 } },
            { $cond: { if: { $eq: [{ $type: '$author' }, 'string'] }, then: { $strLenBytes: '$author' }, else: 0 } },
            { $cond: { if: { $eq: [{ $type: '$category' }, 'string'] }, then: { $strLenBytes: '$category' }, else: 0 } }
          ] }
        }
      },
      {
        $group: {
          _id: null,
          totalSize: { $sum: '$size' }
        }
      }
    ]);
    
    const totalStorageBytes = storageStats[0]?.totalSize || 0;
    const totalStorageMB = Math.round(totalStorageBytes / (1024 * 1024));
    const usedStorageMB = Math.round(totalStorageBytes / (1024 * 1024) * 0.8); // 估算使用率80%
    
    // 构建统计信息响应
    const statistics = {
      articles: {
        total: totalArticles,
        today: todayArticles,
        by_category: articlesByCategory.map(cat => ({
          id: cat._id,
          name: cat._id,
          count: cat.count
        }))
      },
      users: {
        total: totalUsers,
        active: activeUsers
      },
      storage: {
        total_mb: totalStorageMB,
        used_mb: usedStorageMB
      },
      tasks: {
        total: totalTasks,
        success: successTasks
      },
      requests: {
        today: Math.floor(Math.random() * 1000) + 500 // 模拟今日请求数
      },
      errors: {
        today: Math.floor(Math.random() * 10) // 模拟今日错误数
      },
      performance: {
        response_time: Math.floor(Math.random() * 50) + 50, // 模拟响应时间
        requests_per_second: Math.floor(Math.random() * 10) + 5, // 模拟请求/秒
        uptime: 99.9 // 模拟服务可用性
      }
    };

    res.json({
      success: true,
      data: statistics
    });

  } catch (error: any) {
    logger.error('获取统计信息失败:', error);
    res.status(500).json({
      success: false,
      message: '获取统计信息失败',
      error: error.message
    });
  }
});

export default router;