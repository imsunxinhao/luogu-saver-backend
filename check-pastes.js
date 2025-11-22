import mongoose from 'mongoose';
import { Paste } from './dist/models/Paste.js';

async function checkPastes() {
  try {
    // 连接到数据库
    await mongoose.connect('mongodb://localhost:27017/luogu-saver');
    console.log('数据库连接成功');
    
    console.log('检查数据库中的剪切板数据...');
    const pastes = await Paste.find({})
      .sort({ createdAt: -1 })
      .limit(10);
    
    console.log('剪切板总数:', pastes.length);
    console.log('前10个剪切板:');
    pastes.forEach((paste, index) => {
      console.log(`${index + 1}. ID: ${paste.luoguId}, 标题: ${paste.title || '无标题'}, 创建时间: ${paste.createdAt}`);
    });
  } catch (error) {
    console.error('数据库查询错误:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkPastes();