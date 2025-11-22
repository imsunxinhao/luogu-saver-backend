import { Schema, model, Document, Types } from 'mongoose';

export type TaskType = 'article_save' | 'article_update' | 'batch_process' | 'cleanup' | 'paste_save';
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ITask extends Document {
  jobId?: string;
  type: TaskType;
  status: TaskStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  payload: {
    articleId?: string;
    url?: string;
    cookie?: string;
    options?: Record<string, any>;
  };
  result?: {
    success: boolean;
    data?: any;
    error?: string | undefined;
    metadata?: Record<string, any>;
  };
  progress: number;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
  error?: any;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  
  // 实例方法
  startProcessing(): Promise<ITask>;
  complete(result: any): Promise<ITask>;
  fail(error: string): Promise<ITask>;
  updateProgress(progress: number): Promise<ITask>;
  cancel(): Promise<ITask>;
  
  // 虚拟字段
  isRetryable: boolean;
  duration: number | null;
}

const taskSchema = new Schema<ITask>({
  jobId: {
    type: String,
    trim: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['article_save', 'article_update', 'batch_process', 'cleanup', 'paste_save'],
    index: true
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
    index: true
  },
  payload: {
    articleId: {
      type: String,
      trim: true
    },
    url: {
      type: String,
      trim: true
    },
    cookie: {
      type: String,
      trim: true
    },
    options: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  result: {
    success: {
      type: Boolean,
      default: false
    },
    data: {
      type: Schema.Types.Mixed
    },
    error: {
      type: String,
      trim: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  attempts: {
    type: Number,
    default: 0,
    min: 0
  },
  maxAttempts: {
    type: Number,
    default: 3,
    min: 1,
    max: 10
  },
  nextRetryAt: {
    type: Date
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  failedAt: {
    type: Date
  },
  error: {
    type: Schema.Types.Mixed
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 索引优化
taskSchema.index({ status: 1, priority: -1, createdAt: 1 });
taskSchema.index({ type: 1, status: 1 });
taskSchema.index({ 'payload.articleId': 1 });
taskSchema.index({ nextRetryAt: 1 });
taskSchema.index({ createdAt: -1 });
taskSchema.index({ updatedAt: -1 });

// 虚拟字段
taskSchema.virtual('isRetryable').get(function() {
  return this.attempts < this.maxAttempts && this.status === 'failed';
});

taskSchema.virtual('duration').get(function() {
  if (this.startedAt && this.completedAt) {
    return this.completedAt.getTime() - this.startedAt.getTime();
  }
  return null;
});

// 静态方法
taskSchema.statics.findPending = function(limit = 10) {
  return this.find({ 
    status: 'pending',
    $or: [
      { nextRetryAt: { $exists: false } },
      { nextRetryAt: { $lte: new Date() } }
    ]
  })
    .sort({ priority: -1, createdAt: 1 })
    .limit(limit)
    .exec();
};

taskSchema.statics.findByArticleId = function(articleId: string) {
  return this.find({ 'payload.articleId': articleId })
    .sort({ createdAt: -1 })
    .exec();
};

taskSchema.statics.getQueueStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgDuration: {
          $avg: {
            $cond: [
              { $and: ['$startedAt', '$completedAt'] },
              { $subtract: ['$completedAt', '$startedAt'] },
              null
            ]
          }
        }
      }
    }
  ]);
};

// 实例方法
taskSchema.methods.startProcessing = function() {
  this.status = 'processing';
  this.startedAt = new Date();
  this.attempts += 1;
  return this.save();
};

taskSchema.methods.complete = function(result: any) {
  this.status = 'completed';
  this.completedAt = new Date();
  this.result = result;
  return this.save();
};

taskSchema.methods.fail = function(error: string) {
  this.status = 'failed';
  this.completedAt = new Date();
  this.result = {
    success: false,
    error: error
  };
  
  // 设置重试时间（指数退避）
  if (this.isRetryable) {
    const delay = Math.pow(2, this.attempts) * 1000; // 2^attempts 秒
    this.nextRetryAt = new Date(Date.now() + delay);
  }
  
  return this.save();
};

taskSchema.methods.updateProgress = function(progress: number) {
  this.progress = progress;
  return this.save();
};

taskSchema.methods.cancel = function() {
  if (this.status === 'pending' || this.status === 'processing') {
    this.status = 'cancelled';
    this.completedAt = new Date();
    return this.save();
  }
  return Promise.resolve(this);
};

export const Task = model<ITask>('Task', taskSchema);