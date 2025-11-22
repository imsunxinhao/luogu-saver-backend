import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export class AppError extends Error {
  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error = { ...err };
  error.message = err.message;

  // 记录错误
  logger.error('错误处理中间件捕获:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Mongoose 错误处理
  if (err.name === 'CastError') {
    const message = '资源未找到';
    error = new AppError(message, 404);
  }

  // Mongoose 重复键错误
  if (err.name === 'MongoServerError' && (err as any).code === 11000) {
    const message = '资源已存在';
    error = new AppError(message, 400);
  }

  // Mongoose 验证错误
  if (err.name === 'ValidationError') {
    const message = Object.values((err as any).errors).map((val: any) => val.message).join(', ');
    error = new AppError(message, 400);
  }

  // JWT 错误
  if (err.name === 'JsonWebTokenError') {
    const message = '无效的令牌';
    error = new AppError(message, 401);
  }

  // JWT 过期错误
  if (err.name === 'TokenExpiredError') {
    const message = '令牌已过期';
    error = new AppError(message, 401);
  }

  const statusCode = error.statusCode || 500;
  const response = {
    success: false,
    message: error.message || '服务器内部错误'
    // 移除stack信息，避免循环引用问题
  };

  res.status(statusCode).json(response);
};

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new AppError(`路径 ${req.originalUrl} 未找到`, 404);
  next(error);
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};