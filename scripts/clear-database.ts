import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Article } from '../src/models/Article.js';
import { ArticleVersion } from '../src/models/ArticleVersion.js';
import { Task } from '../src/models/Task.js';
import { User } from '../src/models/User.js';

// 加载环境变量
dotenv.config();

// 数据库连接配置
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/luogu-saver-modern';

async function clearDatabase() {
  try {
    console.log('正在连接数据库...');
    
    // 连接数据库
    await mongoose.connect(MONGODB_URI);
    console.log('数据库连接成功');
    
    // 确认操作
    console.log('\n⚠️ 警告：此操作将清空所有数据，包括：');
    console.log('  - 所有文章数据');
    console.log('  - 所有文章版本历史');
    console.log('  - 所有任务记录');
    console.log('  - 所有用户数据');
    console.log('\n此操作不可撤销！');
    
    // 模拟用户确认（在实际使用中，您可能需要添加真实的确认机制）
    console.log('\n模拟确认：开始清空数据库...');
    
    // 开始清空数据
    console.log('\n开始清空数据...');
    
    // 清空文章版本数据（先清空依赖关系）
    console.log('清空文章版本数据...');
    const versionResult = await ArticleVersion.deleteMany({});
    console.log(`已删除 ${versionResult.deletedCount} 条文章版本记录`);
    
    // 清空文章数据
    console.log('清空文章数据...');
    const articleResult = await Article.deleteMany({});
    console.log(`已删除 ${articleResult.deletedCount} 条文章记录`);
    
    // 清空任务数据
    console.log('清空任务数据...');
    const taskResult = await Task.deleteMany({});
    console.log(`已删除 ${taskResult.deletedCount} 条任务记录`);
    
    // 清空用户数据（保留管理员账户）
    console.log('清空用户数据...');
    const userResult = await User.deleteMany({ role: { $ne: 'admin' } });
    console.log(`已删除 ${userResult.deletedCount} 条用户记录（保留管理员账户）`);
    
    console.log('\n✅ 数据库清空完成！');
    console.log('\n数据库状态：');
    console.log(`- 文章数量: ${await Article.countDocuments()}`);
    console.log(`- 文章版本数量: ${await ArticleVersion.countDocuments()}`);
    console.log(`- 任务数量: ${await Task.countDocuments()}`);
    console.log(`- 用户数量: ${await User.countDocuments()}`);
    
  } catch (error) {
    console.error('❌ 清空数据库时发生错误：', error);
    process.exit(1);
  } finally {
    // 关闭数据库连接
    await mongoose.connection.close();
    console.log('\n数据库连接已关闭');
  }
}

// 安全确认函数（在实际使用中可以取消注释）
/*
async function confirmOperation(): Promise<boolean> {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    readline.question('\n⚠️ 确认要清空所有数据吗？输入 "YES" 确认：', (answer) => {
      readline.close();
      resolve(answer === 'YES');
    });
  });
}
*/

// 运行脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  clearDatabase();
}

export { clearDatabase };