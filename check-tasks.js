import { connectDatabase } from './dist/config/database.js';
import { Task } from './dist/models/Task.js';

async function checkTasks() {
  try {
    await connectDatabase();
    const tasks = await Task.find({ type: { $in: ['paste_save', 'article_save'] } }).limit(10);
    console.log('找到的任务:');
    tasks.forEach(task => {
      console.log('ID:', task._id);
      console.log('类型:', task.type);
      console.log('状态:', task.status);
      console.log('载荷:', JSON.stringify(task.payload, null, 2));
      console.log('---');
    });
  } catch (error) {
    console.error('检查任务失败:', error);
  }
}

checkTasks();