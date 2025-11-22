import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';

/**
 * 验证MongoDB ObjectId的中间件
 */
export function validateObjectId(req: Request, res: Response, next: NextFunction) {
  const { id } = req.params;
  
  if (!id || !Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: '无效的ID格式'
    });
  }
  
  next();
  return;
}