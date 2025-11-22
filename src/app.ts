import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { connectDatabase } from './config/database.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { MemoryTaskQueue } from './services/MemoryTaskQueue.js';

// 导入路由
import articleRoutes from './routes/article.routes.js';
import authRoutes from './routes/auth.routes.js';
import taskRoutes from './routes/task.routes.js';
import userRoutes from './routes/user.routes.js';
import statisticsRoutes from './routes/statistics.routes.js';
import pasteRoutes from './routes/paste.routes.js';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;

// 安全中间件
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS配置
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// 压缩
app.use(compression() as any);

// 速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'), // 限制每个IP每15分钟最多100个请求
  message: {
    success: false,
    message: '请求过于频繁，请稍后再试'
  }
});
app.use(limiter);

// API速率限制（更严格）
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: parseInt(process.env.API_RATE_LIMIT_MAX || '60'), // 限制每个IP每15分钟最多60个API请求
  message: {
    success: false,
    message: 'API请求过于频繁，请稍后再试'
  }
});

// 解析JSON请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 请求日志记录
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type')
  });
  next();
});

// 根路径欢迎页面
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '欢迎使用洛谷帖子保存系统后端API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      api: '/api',
      articles: '/api/articles',
      pastes: '/api/pastes',
      auth: '/api/auth',
      tasks: '/api/tasks',
      users: '/api/users',
      statistics: '/api/statistics'
    }
  });
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: '服务运行正常',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API路由（应用速率限制）
app.use('/api/auth', authRoutes);
app.use('/api/articles', apiLimiter, articleRoutes);
app.use('/api/pastes', apiLimiter, pasteRoutes);
app.use('/api/tasks', apiLimiter, taskRoutes);
app.use('/api/users', apiLimiter, userRoutes);
app.use('/api/statistics', apiLimiter, statisticsRoutes);

// Socket.IO连接处理
io.on('connection', (socket) => {
  logger.info(`客户端连接: ${socket.id}`);

  // 加入用户房间（如果已认证）
  socket.on('join-user', (userId: string) => {
    socket.join(`user:${userId}`);
    logger.info(`用户 ${userId} 加入房间`);
  });

  // 离开用户房间
  socket.on('leave-user', (userId: string) => {
    socket.leave(`user:${userId}`);
    logger.info(`用户 ${userId} 离开房间`);
  });

  socket.on('disconnect', () => {
    logger.info(`客户端断开连接: ${socket.id}`);
  });
});

// 错误处理中间件
app.use(errorHandler);

// 404处理
app.use('*', notFound);

// 全局变量
declare global {
  namespace Express {
    interface Application {
      taskQueueService?: MemoryTaskQueue;
      io?: SocketIOServer;
    }
  }
}

// 初始化应用
const initializeApp = async () => {
  try {
    // 连接数据库
    await connectDatabase();
    logger.info('数据库连接成功');

    // 导入所有模型，确保它们被正确注册
    await import('./models/index.js');
    logger.info('模型注册完成');

    // 初始化内存任务队列服务
    const taskQueueService = new MemoryTaskQueue();
    await taskQueueService.initialize();
    app.taskQueueService = taskQueueService;
    app.io = io;
    
    logger.info('任务队列服务初始化成功');

    const PORT = process.env.PORT || 3001;
    
    server.listen(PORT, () => {
      logger.info(`服务器启动成功，端口: ${PORT}`);
      logger.info(`环境: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`CORS允许的源: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
    });

  } catch (error) {
    logger.error('应用初始化失败:', error);
    process.exit(1);
  }
};

// 优雅关闭
const gracefulShutdown = async () => {
  logger.info('开始优雅关闭');
  
  try {
    // 关闭任务队列服务
    if (app.taskQueueService) {
      await app.taskQueueService.close();
      logger.info('任务队列服务已关闭');
    }

    // 关闭服务器
    server.close(() => {
      logger.info('HTTP服务器已关闭');
      process.exit(0);
    });
    
    // 强制关闭超时
    setTimeout(() => {
      logger.error('优雅关闭超时，强制退出');
      process.exit(1);
    }, 10000);
    
  } catch (error) {
    logger.error('优雅关闭过程中发生错误:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export { app, io };

// 启动应用
if (process.env.NODE_ENV !== 'test') {
  initializeApp();
}