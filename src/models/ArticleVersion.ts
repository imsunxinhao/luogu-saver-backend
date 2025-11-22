import { Schema, model, Document, Types } from 'mongoose';

export interface IArticleVersion extends Document {
  _id: any;
  articleId: Types.ObjectId;
  version: number;
  title: string;
  content: string;
  authorUid: string;
  authorName: string;
  category: string;
  tags: string[];
  publishedAt: Date;
  changeDescription?: string;
  changeType: 'created' | 'updated' | 'reverted';
  metadata: {
    wordCount: number;
    readingTime: number;
    hasImages: boolean;
    hasCode: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const articleVersionSchema = new Schema<IArticleVersion>({
  articleId: {
    type: Schema.Types.ObjectId,
    ref: 'Article',
    required: true,
    index: true
  },
  version: {
    type: Number,
    required: true,
    min: 1,
    index: true
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
  publishedAt: {
    type: Date,
    required: true
  },
  changeDescription: {
    type: String,
    trim: true,
    maxlength: 500
  },
  changeType: {
    type: String,
    enum: ['created', 'updated', 'reverted'],
    required: true,
    default: 'created',
    index: true
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
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 复合索引
articleVersionSchema.index({ articleId: 1, version: -1 });
articleVersionSchema.index({ createdAt: -1 });
articleVersionSchema.index({ changeType: 1, createdAt: -1 });

// 静态方法
articleVersionSchema.statics.findByArticleId = function(articleId: Types.ObjectId) {
  return this.find({ articleId })
    .sort({ version: -1 })
    .exec();
};

articleVersionSchema.statics.findLatestVersion = function(articleId: Types.ObjectId) {
  return this.findOne({ articleId })
    .sort({ version: -1 })
    .exec();
};

articleVersionSchema.statics.findByVersion = function(articleId: Types.ObjectId, version: number) {
  return this.findOne({ articleId, version });
};

// 实例方法
articleVersionSchema.methods.updateMetadata = function() {
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

export const ArticleVersion = model<IArticleVersion>('ArticleVersion', articleVersionSchema);