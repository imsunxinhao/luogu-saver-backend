import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    username: string;
    role: string;
  };
}

export const authenticateToken = async (req: AuthRequest, res: any, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: '访问令牌缺失'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;
    
    // 验证用户是否存在且活跃
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: '用户不存在或已被禁用'
      });
    }

    req.user = {
      userId: user._id.toString(),
      username: user.username,
      role: user.role
    };

    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: '无效的访问令牌'
    });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: any, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '需要认证'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: '权限不足'
      });
    }

    next();
  };
};

export const generateToken = (userId: string, username: string, role: string) => {
  return jwt.sign(
    { userId, username, role },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as any
  );
};