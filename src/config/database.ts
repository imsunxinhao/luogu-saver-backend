import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/luogu-saver-modern';

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    mongoose.connection.on('error', (error) => {
      logger.error('MongoDB连接错误:', error);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB连接断开');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB重新连接成功');
    });

  } catch (error) {
    logger.error('MongoDB连接失败:', error);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB连接已断开');
  } catch (error) {
    logger.error('断开MongoDB连接时发生错误:', error);
    throw error;
  }
}