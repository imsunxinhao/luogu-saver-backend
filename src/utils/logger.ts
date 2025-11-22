import winston from 'winston';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    // 安全地处理错误对象，避免循环引用
    if (info.error && info.error instanceof Error) {
      info.error = {
        message: info.error.message,
        stack: info.error.stack
      };
    }
    // 处理其他可能包含循环引用的对象
    Object.keys(info).forEach(key => {
      const value = info[key];
      if (typeof value === 'object' && value !== null && !(value instanceof Error)) {
        try {
          JSON.stringify(value);
        } catch (e) {
          // 如果序列化失败，替换为安全表示
          info[key] = `[Object: ${value.constructor?.name || 'Unknown'}]`;
        }
      }
    });
    return info;
  })(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // 安全地序列化meta对象，避免循环引用
    let safeMeta: Record<string, any> = {};
    if (Object.keys(meta).length) {
      safeMeta = Object.keys(meta).reduce((acc: Record<string, any>, key) => {
        const value = meta[key];
        // 如果是错误对象，只提取消息和堆栈
        if (value instanceof Error) {
          acc[key] = {
            message: value.message,
            stack: value.stack
          };
        } else if (typeof value === 'object' && value !== null) {
          // 对于普通对象，尝试安全序列化
          try {
            JSON.stringify(value);
            acc[key] = value;
          } catch (e) {
            // 如果序列化失败，只记录类型信息
            acc[key] = `[Object: ${value.constructor?.name || 'Unknown'}]`;
          }
        } else {
          acc[key] = value;
        }
        return acc;
      }, {});
    }
    return `${timestamp} [${level}]: ${message} ${Object.keys(safeMeta).length ? JSON.stringify(safeMeta, null, 2) : ''}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  defaultMeta: { service: 'luogu-saver-modern' },
  transports: [
    // 文件传输 - 错误日志
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // 文件传输 - 所有日志
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// 开发环境添加控制台输出
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// 处理未捕获的异常和拒绝
process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝:', { reason, promise });
  process.exit(1);
});