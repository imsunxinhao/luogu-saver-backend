import mongoose from 'mongoose';
import dotenv from 'dotenv';

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
    
    // 获取数据库连接
    const db = mongoose.connection.db;
    
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
    
    // 获取所有集合
    const collections = await db.listCollections().toArray();
    
    for (const collection of collections) {
      const collectionName = collection.name;
      
      // 跳过系统集合
      if (collectionName.startsWith('system.')) {
        continue;
      }
      
      console.log(`清空集合: ${collectionName}...`);
      
      try {
        const result = await db.collection(collectionName).deleteMany({});
        console.log(`  ✅ 已删除 ${result.deletedCount} 条记录`);
      } catch (error) {
        console.log(`  ❌ 清空集合 ${collectionName} 时出错:`, error.message);
      }
    }
    
    console.log('\n✅ 数据库清空完成！');
    
    // 显示清空后的状态
    console.log('\n数据库状态：');
    for (const collection of collections) {
      const collectionName = collection.name;
      if (collectionName.startsWith('system.')) {
        continue;
      }
      
      const count = await db.collection(collectionName).countDocuments();
      console.log(`- ${collectionName}: ${count} 条记录`);
    }
    
  } catch (error) {
    console.error('❌ 清空数据库时发生错误：', error);
    process.exit(1);
  } finally {
    // 关闭数据库连接
    await mongoose.connection.close();
    console.log('\n数据库连接已关闭');
  }
}

// 运行脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  clearDatabase();
}