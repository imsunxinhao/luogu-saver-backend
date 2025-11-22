import express from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// 用户注册
router.post('/register', asyncHandler(async (req: any, res: any) => {
  const { username, email, password } = req.body;

  // 验证必填字段
  if (!username || !email || !password) {
    return res.status(400).json({
      success: false,
      message: '用户名、邮箱和密码为必填项'
    });
  }

  // 检查用户是否已存在
  const existingUser = await User.findOne({
    $or: [{ username }, { email }]
  });

  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: '用户名或邮箱已存在'
    });
  }

  // 创建新用户
  const hashedPassword = await bcrypt.hash(password, 12);
  
  const user = new User({
    username,
    email,
    password: hashedPassword,
    profile: {
      displayName: username
    }
  });

  await user.save();

  // 生成令牌
  const token = generateToken(user._id.toString(), user.username, user.role);

  logger.info(`新用户注册: ${username} (${email})`);

  res.status(201).json({
    success: true,
    message: '注册成功',
    data: {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      },
      token
    }
  });
}));

// 用户登录
router.post('/login', asyncHandler(async (req: any, res: any) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: '用户名和密码为必填项'
    });
  }

  // 查找用户
  const user = await User.findOne({
    $or: [{ username }, { email: username }]
  }).select('+password');

  if (!user || !user.isActive) {
    return res.status(401).json({
      success: false,
      message: '用户不存在或已被禁用'
    });
  }

  // 验证密码
  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: '密码错误'
    });
  }

  // 更新最后登录时间
  user.lastLoginAt = new Date();
  await user.save();

  // 生成令牌
  const token = generateToken(user._id.toString(), user.username, user.role);

  logger.info(`用户登录: ${username}`);

  res.json({
    success: true,
    message: '登录成功',
    data: {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profile: user.profile
      },
      token
    }
  });
}));

// 获取当前用户信息
router.get('/me', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const user = await User.findById(req.user.userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: '用户不存在'
    });
  }

  res.json({
    success: true,
    data: {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profile: user.profile,
        preferences: user.preferences,
        statistics: user.statistics
      }
    }
  });
}));

// 更新用户信息
router.put('/profile', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { displayName, bio, avatar } = req.body;

  const user = await User.findById(req.user.userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: '用户不存在'
    });
  }

  // 更新个人资料
  if (displayName) user.profile.displayName = displayName;
  if (bio !== undefined) user.profile.bio = bio;
  if (avatar) user.profile.avatar = avatar;

  await user.save();

  res.json({
    success: true,
    message: '个人资料更新成功',
    data: {
      user: {
        id: user._id,
        username: user.username,
        profile: user.profile
      }
    }
  });
}));

// 修改密码
router.put('/password', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: '当前密码和新密码为必填项'
    });
  }

  const user = await User.findById(req.user.userId).select('+password');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: '用户不存在'
    });
  }

  // 验证当前密码
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

  if (!isCurrentPasswordValid) {
    return res.status(401).json({
      success: false,
      message: '当前密码错误'
    });
  }

  // 更新密码
  user.password = await bcrypt.hash(newPassword, 12);
  await user.save();

  logger.info(`用户修改密码: ${user.username}`);

  res.json({
    success: true,
    message: '密码修改成功'
  });
}));

export default router;