import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 导入并启动应用
import('./app.js').then(module => {
  // 应用会在导入时自动启动
  console.log('应用启动脚本已执行');
}).catch(error => {
  console.error('应用启动失败:', error);
  process.exit(1);
});