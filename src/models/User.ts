import { Schema, model, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  _id: any;
  username: string;
  email: string;
  password: string;
  role: 'user' | 'admin' | 'moderator';
  profile: {
    displayName: string;
    avatar?: string;
    bio?: string;
    website?: string;
  };
  preferences: {
    theme: 'light' | 'dark' | 'auto';
    language: 'zh' | 'en';
    notifications: {
      email: boolean;
      push: boolean;
    };
  };
  statistics: {
    articlesSaved: number;
    articlesViewed: number;
    lastLogin: Date;
    loginCount: number;
  };
  isActive: boolean;
  lastLoginAt: Date;
  createdAt: Date;
  updatedAt: Date;
  
  // 方法
  comparePassword(candidatePassword: string): Promise<boolean>;
  incrementLoginCount(): Promise<IUser>;
  incrementArticlesSaved(): Promise<IUser>;
  incrementArticlesViewed(): Promise<IUser>;
}

const userSchema = new Schema<IUser>({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: /^[a-zA-Z0-9_]+$/
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'moderator'],
    default: 'user',
    index: true
  },
  profile: {
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50
    },
    avatar: {
      type: String,
      trim: true
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 500
    },
    website: {
      type: String,
      trim: true
    }
  },
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    },
    language: {
      type: String,
      enum: ['zh', 'en'],
      default: 'zh'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      }
    }
  },
  statistics: {
    articlesSaved: {
      type: Number,
      default: 0,
      min: 0
    },
    articlesViewed: {
      type: Number,
      default: 0,
      min: 0
    },
    lastLogin: {
      type: Date,
      default: Date.now
    },
    loginCount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  lastLoginAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      if (ret.password) {
        delete (ret as any).password;
      }
      return ret;
    }
  }
});

// 索引优化
userSchema.index({ createdAt: -1 });
userSchema.index({ 'statistics.articlesSaved': -1 });

// 密码加密中间件
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12');
    this.password = await bcrypt.hash(this.password, saltRounds);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// 密码比较方法
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// 静态方法
userSchema.statics.findByUsername = function(username: string) {
  return this.findOne({ username });
};

userSchema.statics.findByEmail = function(email: string) {
  return this.findOne({ email });
};

userSchema.statics.getTopUsers = function(limit = 10) {
  return this.find({ isActive: true })
    .sort({ 'statistics.articlesSaved': -1 })
    .limit(limit)
    .select('username profile statistics')
    .exec();
};

// 实例方法
userSchema.methods.incrementLoginCount = function() {
  this.statistics.loginCount += 1;
  this.lastLoginAt = new Date();
  return this.save();
};

userSchema.methods.incrementArticlesSaved = function() {
  this.statistics.articlesSaved += 1;
  return this.save();
};

userSchema.methods.incrementArticlesViewed = function() {
  this.statistics.articlesViewed += 1;
  return this.save();
};

export const User = model<IUser>('User', userSchema);