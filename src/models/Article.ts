import { Schema, model, Document, Types, Model } from 'mongoose';

export interface IArticle extends Document {
  _id: any;
  luoguId: string;
  title: string;
  content: string;
  authorUid: string;
  authorName: string;
  category: string;
  tags: string[];
  isPublic: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: Date;
  crawledAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  metadata: {
    wordCount: number;
    readingTime: number;
    hasImages: boolean;
    hasCode: boolean;
  };
  versions: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
  
  // 实例方法
  incrementViewCount(): Promise<IArticle>;
  updateMetadata(): Promise<IArticle>;
  
  // 虚拟字段
  url: string;
}

// 静态方法接口
export interface ArticleModel extends Model<IArticle> {
  // Mongoose标准方法
  find(conditions?: any): any;
  findOne(conditions?: any): any;
  countDocuments(conditions?: any): any;
  deleteOne(conditions?: any): any;
  
  // 构造函数
  new(doc?: any): IArticle;
  
  // 自定义静态方法
  findByLuoguId(luoguId: string): Promise<IArticle | null>;
  findRecent(limit?: number): Promise<IArticle[]>;
  findByAuthor(authorUid: string, page?: number, limit?: number): Promise<IArticle[]>;
}

const articleSchema = new Schema<IArticle>({
  luoguId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  content: {
    type: String,
    required: true
  },
  authorUid: {
    type: String,
    required: true,
    index: true
  },
  authorName: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    default: '未分类',
    index: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  isPublic: {
    type: Boolean,
    default: true,
    index: true
  },
  viewCount: {
    type: Number,
    default: 0,
    min: 0
  },
  likeCount: {
    type: Number,
    default: 0,
    min: 0
  },
  commentCount: {
    type: Number,
    default: 0,
    min: 0
  },
  publishedAt: {
    type: Date,
    required: true
  },
  updatedAt: {
    type: Date,
    required: true
  },
  crawledAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  errorMessage: {
    type: String,
    trim: true
  },
  metadata: {
    wordCount: {
      type: Number,
      default: 0,
      min: 0
    },
    readingTime: {
      type: Number,
      default: 0,
      min: 0
    },
    hasImages: {
      type: Boolean,
      default: false
    },
    hasCode: {
      type: Boolean,
      default: false
    }
  },
  versions: [{
    type: Schema.Types.ObjectId,
    ref: 'ArticleVersion'
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 索引优化
articleSchema.index({ createdAt: -1 });
articleSchema.index({ updatedAt: -1 });
articleSchema.index({ authorUid: 1, createdAt: -1 });
articleSchema.index({ category: 1, createdAt: -1 });
articleSchema.index({ tags: 1, createdAt: -1 });
articleSchema.index({ status: 1, createdAt: -1 });

// 虚拟字段
articleSchema.virtual('url').get(function() {
  return `https://www.luogu.com/article/${this.luoguId}`;
});

// 静态方法
articleSchema.statics.findByLuoguId = function(luoguId: string) {
  return this.findOne({ luoguId });
};

articleSchema.statics.findRecent = function(limit = 20) {
  return this.find({ status: 'completed', isPublic: true })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('versions', 'createdAt')
    .exec();
};

articleSchema.statics.findByAuthor = function(authorUid: string, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  return this.find({ authorUid, status: 'completed', isPublic: true })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .exec();
};

// 实例方法
articleSchema.methods.incrementViewCount = function() {
  this.viewCount += 1;
  return this.save();
};

articleSchema.methods.updateMetadata = function() {
  // 计算字数
  const textContent = this.content.replace(/<[^>]*>/g, '');
  this.metadata.wordCount = textContent.length;
  
  // 计算阅读时间（按每分钟200字计算）
  this.metadata.readingTime = Math.ceil(this.metadata.wordCount / 200);
  
  // 检查是否包含图片
  this.metadata.hasImages = /<img[^>]*>/i.test(this.content);
  
  // 检查是否包含代码
  this.metadata.hasCode = /<pre[^>]*>|<code[^>]*>/i.test(this.content);
  
  return this.save();
};

// 中间件
articleSchema.pre('save', function(next) {
  if (this.isModified('content')) {
    this.updatedAt = new Date();
  }
  next();
});

export const Article = model<IArticle, ArticleModel>('Article', articleSchema);