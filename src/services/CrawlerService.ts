import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';
import { Article } from '../models/Article.js';
import { Paste } from '../models/Paste.js';
import { Task } from '../models/Task.js';

export interface CrawlResult {
  success: boolean;
  data?: {
    luoguId: string;
    title: string;
    content: string;
    authorUid: string;
    authorName: string;
    category: string;
    tags?: string[];
    publishedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };
  message?: string;
  statusCode?: number;
}

// 从pastebin-and-blog项目借鉴的错误类型
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ExternalServiceError extends Error {
  constructor(message: string, service: string) {
    super(`${service} 服务错误: ${message}`);
    this.name = 'ExternalServiceError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class CrawlerService {
  private readonly baseUrl = 'https://www.luogu.com';
  private readonly userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];

  // 从pastebin-and-blog项目借鉴的默认请求头
  private readonly defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36',
    'x-luogu-type': 'content-only',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  // 从pastebin-and-blog项目借鉴的请求配置
  private readonly frontendFetchConfig = {
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 30000
  };

  private getRandomUserAgent(): string {
    const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    return userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  // 从pastebin-and-blog项目借鉴的重定向调试函数
  static async debugRedirects(url: string, headers: any = {}, timeout = 30000): Promise<string> {
    let currentUrl = url;
    let depth = 0;
    const redirectChain: string[] = [currentUrl];
    
    while (depth < 20) {
      const response = await axios.get(currentUrl, {
        maxRedirects: 0,
        validateStatus: () => true,
        timeout
      });
      
      if (response.headers && response.headers['set-cookie']) {
        headers['Cookie'] = response.headers['set-cookie'].map((c: string) => c.split(';')[0]).join('; ');
      }
      
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        currentUrl = new URL(response.headers.location, currentUrl).toString();
        redirectChain.push(currentUrl);
        depth++;
      } else {
        break;
      }
    }
    
    return `重定向链 (深度 ${depth}): ${redirectChain.join(' -> ')}`;
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 从pastebin-and-blog项目借鉴的Cookie合并函数
  private mergeSetCookieToHeaders(response: any, headers: any): void {
    const setCookie = response.headers && response.headers['set-cookie'];
    if (!setCookie) return;
    
    const existingCookies = headers.Cookie ? 
      headers.Cookie.split('; ').reduce((acc: any, cur: string) => { 
        const [k, v] = cur.split('='); 
        if (k && v) acc[k] = v; 
        return acc; 
      }, {}) : {};
    
    setCookie.forEach((cookieStr: string) => {
      const [cookiePair] = cookieStr.split(';');
      if (cookiePair) {
        const [k, v] = cookiePair.split('=');
        if (k && v) {
          existingCookies[k] = v;
        }
      }
    });
    
    headers.Cookie = Object.entries(existingCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  // 从pastebin-and-blog项目借鉴的fetchContent方法
  private async fetchContent(url: string, headers: any = {}, { c3vk = "new", timeout = 30000 } = {}): Promise<{ resp: any; headers: any }> {
    logger.debug(`抓取网页: ${url}，c3vk 模式: ${c3vk}`);
    const h = { ...this.defaultHeaders, ...headers };
    let resp;
    
    try {
      resp = await axios.get(url, {
        ...this.frontendFetchConfig,
        headers: h,
        timeout
      });
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ||
          err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' ||
          err.code === 'ECONNRESET' || err.message?.includes('timeout')) {
        throw new NetworkError(`网络请求失败: ${err.message || err.code}`);
      }
      throw err;
    }
    
    if (c3vk === "legacy") {
      resp = await this.handleLegacyC3VK(resp, url, h, timeout);
    }
    
    if (c3vk === "new" && resp.status === 302 && resp.headers.location) {
      this.mergeSetCookieToHeaders(resp, h);
      
      try {
        resp = await axios.get(url, {
          ...this.frontendFetchConfig,
          headers: h,
          timeout
        });
      } catch (err: any) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || 
            err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' ||
            err.code === 'ECONNRESET' || err.message?.includes('timeout')) {
          throw new NetworkError(`网络请求失败: ${err.message || err.code}`);
        }
        throw err;
      }
    }
    
    logger.debug(`已抓取网页: ${url}，状态码: ${resp.status}`);
    if (resp.status === 401) {
      logger.debug(`Cookies 过期: ${headers.Cookie}`);
    }
    
    return { resp, headers: h };
  }

  // 从pastebin-and-blog项目借鉴的handleLegacyC3VK方法
  private async handleLegacyC3VK(response: any, url: string, headers: any, timeout = 30000): Promise<any> {
    if (typeof response.data === 'string') {
      const m = (response.data).match(/C3VK=([a-zA-Z0-9]+);/);
      if (m) {
        const c3vk = m[1];
        return await axios.get(url, {
          headers: { ...headers, Cookie: `C3VK=${c3vk}` },
          timeout
        });
      }
    }
    return response;
  }

  // 完全参考旧版后端的getResponseObject方法实现
  private getResponseObject(response: any, type: string = ''): any {
    // 旧版后端实现：type为0时处理文章，type为1时处理剪切板
    // 现代版调整为：空type处理文章，'paste'处理剪切板
    
    if (!type) {
      // 文章类型处理 - 完全参考旧版后端实现
      const $ = cheerio.load(response.data);
      const contextElement = $('#lentille-context');
      if (!contextElement.length) return null;
      
      try {
        const dataObj = JSON.parse(contextElement.text().trim());
        return dataObj.data?.article;
      } catch (error) {
        logger.warn(`JSON解析失败: ${error}`);
        return null;
      }
    } else if (type === 'paste') {
      // 剪切板类型处理 - 完全参考旧版后端实现逻辑
      // 1. 首先尝试直接获取response.data.currentData.paste（旧版后端的主要方法）
      if (response.data?.currentData?.paste) {
        return response.data.currentData.paste;
      }
      
      // 2. 尝试从#lentille-context元素中解析（旧版后端的主要方法）
      const $ = cheerio.load(response.data);
      const contextElement = $('#lentille-context');
      if (contextElement.length) {
        try {
          const dataObj = JSON.parse(contextElement.text().trim());
          if (dataObj.data?.paste) {
            return dataObj.data.paste;
          }
        } catch (error) {
          logger.warn(`剪切板contextElement JSON解析失败: ${error}`);
        }
      }
      
      // 3. 尝试从script标签中解析各种可能的JSON格式（旧版后端的备用方法）
      const scripts = $('script');
      for (let i = 0; i < scripts.length; i++) {
        const scriptContent = $(scripts[i])
        const scriptText = scriptContent.text();
        if (scriptText && scriptText.includes('paste')) {
          try {
            // 尝试解析window.__INITIAL_STATE__格式
            if (scriptText.includes('window.__INITIAL_STATE__')) {
              const match = scriptText.match(/window\.__INITIAL_STATE__\s*=\s*({[^;]+});/);
              if (match && match[1]) {
                const stateObj = JSON.parse(match[1]);
                if (stateObj.currentData?.paste) {
                  return stateObj.currentData.paste;
                }
              }
            }
            
            // 尝试解析包含"paste"的JSON对象
            const jsonMatch = scriptText.match(/{\s*"paste"\s*:[^}]+}/);
            if (jsonMatch) {
              const pasteObj = JSON.parse(jsonMatch[0]);
              if (pasteObj.paste) {
                return pasteObj.paste;
              }
            }
            
            // 尝试解析window._feInjection格式
            if (scriptText.includes('window._feInjection')) {
              const match = scriptText.match(/window\._feInjection\s*=\s*JSON\.parse\("([^"]+)"\)/);
              if (match && match[1]) {
                const decoded = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                const injectionObj = JSON.parse(decoded);
                if (injectionObj.currentData?.paste) {
                  return injectionObj.currentData.paste;
                }
              }
            }
          } catch (error) {
            logger.warn(`剪切板script标签JSON解析失败: ${error}`);
          }
        }
      }
      
      return null;
    }
    
    return null;
  }

  // 完全参考旧版后端的通用获取处理器实现
  private async commonFetchHandler(response: any, type: string = ''): Promise<any> {
    // 参考旧版后端common.fetch.handler.js的实现
    const obj = this.getResponseObject(response, type);
    if (!obj) return null;
    
    // 内容截断处理（参考旧版后端的truncateUtf8逻辑）
    if (type === 'paste') {
      // 剪切板类型：截断content字段（剪切板数据在content字段中）
      obj.content = this.truncateUtf8(obj.content);
    } else {
      // 文章类型：截断content字段
      obj.content = this.truncateUtf8(obj.content);
    }
    
    // 提取用户数据（参考旧版后端的getResponseUser逻辑）
    obj.userData = this.getResponseUser(obj);
    
    // 保存用户信息（参考旧版后端的upsertUser逻辑）
    await this.upsertUser(obj.userData);
    
    return obj;
  }

  // 参考旧版后端的truncateUtf8实现
  private truncateUtf8(text: string, maxLength: number = 100000): string {
    if (!text || text.length <= maxLength) return text;
    
    // UTF-8安全截断
    let truncated = text.substring(0, maxLength);
    // 确保不截断在UTF-8字符中间
    while (truncated.length > 0 && (truncated.charCodeAt(truncated.length - 1) & 0xC0) === 0x80) {
      truncated = truncated.substring(0, truncated.length - 1);
    }
    
    return truncated;
  }

  // 参考旧版后端的getResponseUser实现
  private getResponseUser(obj: any): any {
    if (!obj) return null;
    
    // 从对象中提取用户信息
    const userData = {
      uid: obj.author?.uid?.toString() || obj.uid?.toString() || 'unknown',
      name: obj.author?.name || obj.name || '未知用户',
      color: obj.author?.color || obj.color || '#000000'
    };
    
    return userData;
  }

  // 参考旧版后端的upsertUser实现
  private async upsertUser(userData: any): Promise<void> {
    if (!userData || !userData.uid) return;
    
    try {
      // 这里可以添加用户信息保存逻辑
      // 现代版暂时不实现完整的用户系统，保留接口
      logger.debug(`用户信息处理: ${userData.uid} - ${userData.name}`);
    } catch (error) {
      logger.warn(`保存用户信息失败: ${error}`);
    }
  }



  // 删除重复的getResponseUser方法定义
  private createHeaders(cookie?: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      'User-Agent': this.getRandomUserAgent(),
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Pragma': 'no-cache',
      'Referer': 'https://www.luogu.com/',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    };

    if (cookie) {
      headers['Cookie'] = cookie;
    }

    return headers;
  }

  // 新增：专门针对洛谷JSONGET API的优化方法
  private async fetchLuoguJsonApi(url: string, headers: any = {}): Promise<any> {
    // 参考旧版后端的JSONGET方式，添加特定的API参数
    const apiUrl = new URL(url);
    
    // 添加JSONGET参数，参考洛谷API的常见参数
    apiUrl.searchParams.set('_contentOnly', '1');
    apiUrl.searchParams.set('_format', 'json');
    apiUrl.searchParams.set('_timestamp', Date.now().toString());
    
    // 设置JSON特定的请求头
    const jsonHeaders = {
      ...headers,
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };

    try {
      const response = await axios.get(apiUrl.toString(), {
        ...this.frontendFetchConfig,
        headers: jsonHeaders,
        timeout: 30000
      });

      return response;
    } catch (error: any) {
      logger.warn(`JSONGET API请求失败: ${error.message}`);
      // 如果JSONGET失败，回退到普通请求
      return await axios.get(url, {
        ...this.frontendFetchConfig,
        headers,
        timeout: 30000
      });
    }
  }

  // 优化后的文章爬取方法，使用JSONGET API
  async crawlArticle(articleId: string, cookie?: string): Promise<CrawlResult> {
    const url = `https://www.luogu.com/article/${articleId}`;
    
    // 添加随机延迟
    await CrawlerService.delay(Math.random() * 2000 + 1000);

    try {
      const headers = this.createHeaders(cookie);
      let response;
      
      // 优先使用JSONGET API方式
      try {
        response = await this.fetchLuoguJsonApi(url, headers);
      } catch (error: any) {
        // 如果JSONGET失败，回退到普通请求
        response = await axios.get(url, {
          ...this.frontendFetchConfig,
          headers
        });
      }

      // 处理302重定向并自动更新Cookie（从pastebin-and-blog项目借鉴）
      if (response.status === 302 && response.headers.location) {
        this.mergeSetCookieToHeaders(response, headers);
        
        // 使用更新后的Cookie重试请求
        try {
          response = await this.fetchLuoguJsonApi(url, headers);
        } catch (error: any) {
          response = await axios.get(url, {
            ...this.frontendFetchConfig,
            headers
          });
        }
      }

      logger.debug(`已抓取网页: ${url}，状态码: ${response.status}`);

      // 处理重定向
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (location) {
          if (location.includes('auth/login') || location.includes('login')) {
            return {
              success: false,
              message: '需要登录: 文章需要登录才能访问',
              statusCode: response.status
            };
          }
          return {
            success: false,
            message: `HTTP重定向: ${response.status} -> ${location}`,
            statusCode: response.status
          };
        }
      }

      // 处理其他状态码
      if (response.status !== 200) {
        if (response.status === 404) {
          return {
            success: false,
            message: '文章不存在或已被删除',
            statusCode: 404
          };
        } else if (response.status === 403 || response.status === 451) {
          return {
            success: false,
            message: '访问被拒绝: 文章可能受权限保护',
            statusCode: response.status
          };
        } else if (response.status === 401) {
          logger.debug(`Cookies 过期: ${headers.Cookie}`);
          return {
            success: false,
            message: '需要登录: 认证已过期',
            statusCode: 401
          };
        } else {
          return {
            success: false,
            message: `HTTP错误: ${response.status}`,
            statusCode: response.status
          };
        }
      }

      // 检查是否为JSON响应
      const contentType = response.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        // 直接处理JSON响应
        try {
          const jsonData = response.data;
          const articleData = jsonData.currentData?.article || jsonData.data?.article;
          
          if (!articleData) {
            return {
              success: false,
              message: 'JSON数据解析失败',
              statusCode: 200
            };
          }

          // 从JSON数据中提取文章信息
          const title = articleData.title || '未命名文章';
          const content = articleData.content || '';
          const authorUid = articleData.author?.uid?.toString() || 'unknown';
          const authorName = articleData.author?.name || '未知作者';
          const category = articleData.category || '未分类';
          const tags: string[] = articleData.tags || [];
          const publishedAt = articleData.time ? new Date(articleData.time * 1000) : new Date();

          return {
            success: true,
            data: {
              luoguId: articleId,
              title,
              content,
              authorUid,
              authorName,
              category,
              tags,
              publishedAt,
              createdAt: publishedAt,
              updatedAt: new Date()
            }
          };
        } catch (error) {
          logger.warn(`JSON响应解析失败，回退到HTML解析: ${error}`);
        }
      }

      // 如果不是JSON响应或JSON解析失败，回退到HTML解析
      const $ = cheerio.load(response.data);
      
      // 检查是否被重定向到登录页面
      if ($('title').text().includes('登录') || $('input[name="username"]').length > 0) {
        return {
          success: false,
          message: '需要登录验证，请提供有效的Cookie',
          statusCode: 401
        };
      }

      // 检查安全验证页面（参考旧版后端的实现）
      // 1. 检查"继续访问"按钮和#go元素
      const hasContinueButton = $('a').filter((_, el) => $(el).text().includes('继续访问')).length > 0 ||
                               $('button').filter((_, el) => $(el).text().includes('继续访问')).length > 0 ||
                               $('p').filter((_, el) => $(el).text().includes('继续访问')).length > 0;
      
      if ($('#go').length > 0 && hasContinueButton) {
        return {
          success: false,
          message: '需要安全验证: 文章需要用户交互才能访问',
          statusCode: 200
        };
      }

      // 2. 检查标题或正文中的安全验证关键词
      const pageTitle = $('title').text();
      const pageBody = $('body').text();
      
      if (pageTitle.includes('安全验证') || pageTitle.includes('验证码') || 
          pageTitle.includes('安全检查') || pageTitle.includes('安全检测') ||
          pageBody.includes('安全验证') || pageBody.includes('验证码') ||
          pageBody.includes('安全检查') || pageBody.includes('安全检测')) {
        return {
          success: false,
          message: '需要安全验证: 文章需要验证码验证',
          statusCode: 200
        };
      }

      // 3. 检查常见的验证码页面元素
      if ($('#captcha').length > 0 || $('.captcha').length > 0 ||
          $('input[name="captcha"]').length > 0 || $('input[name="code"]').length > 0) {
        return {
          success: false,
          message: '需要安全验证: 文章需要输入验证码',
          statusCode: 200
        };
      }

      // 从成熟爬虫项目借鉴的JSON数据解析方法
      const contextElement = $('#lentille-context');
      if (!contextElement.length) {
        // 如果找不到JSON数据，回退到传统HTML解析方法
        return this.parseArticleFromHTML($, articleId);
      }

      try {
        const dataObj = JSON.parse(contextElement.text().trim());
        const articleData = dataObj.data?.article;
        
        if (!articleData) {
          return {
            success: false,
            message: '文章数据解析失败',
            statusCode: 200
          };
        }

        // 从JSON数据中提取文章信息
        const title = articleData.title || '未命名文章';
        const content = articleData.content || '';
        const authorUid = articleData.author?.uid?.toString() || 'unknown';
        const authorName = articleData.author?.name || '未知作者';
        const category = articleData.category || '未分类';
        const tags: string[] = articleData.tags || [];
        const publishedAt = articleData.time ? new Date(articleData.time * 1000) : new Date();

        return {
          success: true,
          data: {
            luoguId: articleId,
            title,
            content,
            authorUid,
            authorName,
            category,
            tags,
            publishedAt,
            createdAt: publishedAt,
            updatedAt: new Date()
          }
        };

      } catch (error) {
        logger.warn(`JSON解析失败，回退到HTML解析: ${error}`);
        // JSON解析失败时回退到传统HTML解析
        return this.parseArticleFromHTML($, articleId);
      }

    } catch (error: any) {
      logger.error(`爬取文章失败: ${articleId}`, error);
      
      // 彻底避免循环引用：只返回简单的字符串消息
      let errorMessage = '未知错误';
      
      try {
        if (error.response) {
          errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
        } else if (error.code === 'ECONNABORTED') {
          errorMessage = '请求超时';
        } else if (error.message && typeof error.message === 'string') {
          errorMessage = error.message;
        }
      } catch (e) {
        // 如果提取错误消息时发生错误，使用默认消息
        errorMessage = '网络请求失败';
      }
      
      return {
        success: false,
        message: errorMessage
      };
    }
  }

  private parseArticleFromHTML($: cheerio.CheerioAPI, articleId: string): CrawlResult {
    // 提取文章标题
    const title = $('h1').first().text().trim() || '未命名文章';
    
    // 提取文章内容
    const contentElement = $('.article-content').first() || $('article').first();
    if (!contentElement.length) {
      return {
        success: false,
        message: '无法找到文章内容',
        statusCode: 200
      };
    }

    // 清理内容，移除不需要的元素
    contentElement.find('script, style, .ad, .ads').remove();
    const content = contentElement.html() || '';

    // 提取作者信息
    const authorElement = $('.user-name a').first();
    const authorName = authorElement.text().trim() || '未知作者';
    const authorUid = authorElement.attr('href')?.split('/').pop() || 'unknown';

    // 提取分类和标签
    const category = $('.article-category').text().trim() || '未分类';
    const tags: string[] = [];
    $('.tag').each((_, element) => {
      const tag = $(element).text().trim();
      if (tag) tags.push(tag);
    });

    // 提取发布时间
    const timeElement = $('.article-time').first();
    const timeText = timeElement.text().trim();
    const publishedAt = this.parseTime(timeText) || new Date();

    return {
      success: true,
      data: {
        luoguId: articleId,
        title,
        content,
        authorUid,
        authorName,
        category,
        tags,
        publishedAt,
        createdAt: publishedAt,
        updatedAt: new Date()
      }
    };
  }

  private parseTime(timeText: string): Date | null {
    try {
      // 处理各种时间格式
      if (timeText.includes('今天')) {
        const today = new Date();
        const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch && timeMatch[1] && timeMatch[2]) {
          today.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
          return today;
        }
      }
      
      if (timeText.includes('昨天')) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch && timeMatch[1] && timeMatch[2]) {
          yesterday.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
          return yesterday;
        }
      }
      
      // 尝试解析标准日期格式
      const parsedDate = new Date(timeText);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate;
      }
      
      return null;
    } catch {
      return null;
    }
  }

  async saveArticleFromTask(taskId: string): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      const task = await Task.findById(taskId);
      if (!task) {
        return {
          success: false,
          message: '任务不存在'
        };
      }

      if (task.status !== 'pending') {
        return {
          success: false,
          message: '任务状态无效'
        };
      }

      // 开始处理任务
      await task.startProcessing();

      const { articleId, cookie } = task.payload;
      
      if (!articleId) {
        await task.fail('文章ID缺失');
        return {
          success: false,
          message: '文章ID缺失'
        };
      }

      // 爬取文章
      const crawlResult = await this.crawlArticle(articleId, cookie);
      
      if (!crawlResult.success) {
        await task.fail(crawlResult.message || '爬取失败');
        return {
          success: false,
          message: crawlResult.message || '爬取失败'
        };
      }

      const articleData = crawlResult.data!;

      // 检查文章是否已存在
      const existingArticle = await Article.findOne({ luoguId: articleId });
      
      if (existingArticle) {
        // 更新现有文章
        existingArticle.title = articleData.title;
        existingArticle.content = articleData.content;
        existingArticle.authorUid = articleData.authorUid;
        existingArticle.authorName = articleData.authorName;
        existingArticle.category = articleData.category;
        existingArticle.tags = articleData.tags;
        (existingArticle as any).updatedAt = articleData.updatedAt;
        existingArticle.crawledAt = new Date();
        existingArticle.status = 'completed';
        
        await existingArticle.save();
        await existingArticle.updateMetadata();
        
        await task.complete({
          success: true,
          data: existingArticle.toJSON(),
          metadata: { action: 'updated' }
        });
        
        return {
          success: true,
          message: '文章更新成功',
          data: existingArticle.toObject()
        };
      } else {
        // 创建新文章
        const newArticle = new Article({
          luoguId: articleData.luoguId,
          title: articleData.title,
          content: articleData.content,
          authorUid: articleData.authorUid,
          authorName: articleData.authorName,
          category: articleData.category,
          tags: articleData.tags,
          publishedAt: articleData.publishedAt,
          updatedAt: articleData.updatedAt,
          crawledAt: new Date(),
          status: 'completed'
        });
        
        await newArticle.save();
        await newArticle.updateMetadata();
        
        await task.complete({
          success: true,
          data: newArticle.toJSON(),
          metadata: { action: 'created' }
        });
        
        return {
          success: true,
          message: '文章保存成功',
          data: newArticle.toObject()
        };
      }

    } catch (error: any) {
      logger.error('处理保存任务失败:', error);
      
      // 更新任务状态
      const task = await Task.findById(taskId);
      if (task) {
        await task.fail(error.message || '处理失败');
      }
      
      return {
        success: false,
        message: error.message || '处理失败'
      };
    }
  }

  async saveArticleDirectly(articleId: string, cookie?: string): Promise<{ success: boolean; message: string; data?: any }> {
    const maxRetries = parseInt(process.env.CRAWLER_MAX_RETRIES || '3');
    let lastError: any = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`第${attempt}次尝试保存文章: ${articleId}`);
        
        // 添加随机延迟
        await CrawlerService.delay(Math.random() * 2000 + 1000);
        
        const crawlResult = await this.crawlArticle(articleId, cookie);
        
        if (!crawlResult.success) {
          // 如果是HTTP 451错误，等待更长时间后重试
          if (crawlResult.statusCode === 451) {
            logger.info(`检测到反爬虫限制，等待${attempt * 5}秒后重试...`);
            await CrawlerService.delay(attempt * 5000);
            lastError = new Error(crawlResult.message);
            continue;
          }
          
          return {
            success: false,
            message: crawlResult.message || '爬取失败'
          };
        }

        const articleData = crawlResult.data!;

        // 检查文章是否已存在
        const existingArticle = await Article.findOne({ luoguId: articleId });
        
        if (existingArticle) {
          // 更新现有文章
          existingArticle.title = articleData.title;
          existingArticle.content = articleData.content;
          existingArticle.authorUid = articleData.authorUid;
          existingArticle.authorName = articleData.authorName;
          existingArticle.category = articleData.category;
          existingArticle.tags = articleData.tags;
          existingArticle.updatedAt = articleData.updatedAt;
          existingArticle.crawledAt = new Date();
          existingArticle.status = 'completed';
          
          await existingArticle.save();
          await existingArticle.updateMetadata();
          
          return {
            success: true,
            message: '文章更新成功',
            data: existingArticle.toObject()
          };
        } else {
          // 创建新文章
          const newArticle = new Article({
            luoguId: articleData.luoguId,
            title: articleData.title,
            content: articleData.content,
            authorUid: articleData.authorUid,
            authorName: articleData.authorName,
            category: articleData.category,
            tags: articleData.tags,
            publishedAt: articleData.publishedAt,
            updatedAt: articleData.updatedAt,
            crawledAt: new Date(),
            status: 'completed'
          });
          
          await newArticle.save();
          await newArticle.updateMetadata();
          
          return {
            success: true,
            message: '文章保存成功',
            data: newArticle.toObject()
          };
        }

      } catch (error: any) {
        logger.error(`第${attempt}次尝试保存文章时发生错误:`, error);
        // 只保存错误消息，避免保存包含循环引用的完整错误对象
        lastError = error.message || '保存失败';
        
        // 如果是HTTP 451错误，等待更长时间后重试
        if (error.message?.includes('451') || error.message?.includes('Unavailable For Legal Reasons')) {
          logger.info(`检测到反爬虫限制，等待${attempt * 5}秒后重试...`);
          await CrawlerService.delay(attempt * 5000);
          continue;
        }
        
        // 其他错误直接返回
        break;
      }
    }
    
    // 所有重试都失败
    return {
      success: false,
      message: lastError || '保存失败'
    };
  }

  // 完全参考旧版后端的爬虫任务处理架构
  async crawlPaste(pasteId: string, cookie?: string): Promise<CrawlResult> {
    const url = `https://www.luogu.com/paste/${pasteId}`;
    
    // 参考旧版后端的随机延迟策略
    await CrawlerService.delay(Math.random() * 2000 + 1000);

    try {
      let headers = this.createHeaders(cookie);
      
      // 使用旧版后端的fetchContent方法逻辑
      let { resp: response, headers: updatedHeaders } = await this.fetchContent(url, headers, { c3vk: 'new' });
      
      // 参考旧版后端的Cookie管理和重试逻辑
      if (response.status === 302 && response.headers.location) {
        // 自动合并Cookie并重试（参考旧版后端的mergeSetCookieToHeaders逻辑）
        this.mergeSetCookieToHeaders(response, headers);
        
        // 重试请求
        ({ resp: response, headers: updatedHeaders } = await this.fetchContent(url, headers, { c3vk: 'new' }));
      }
      
      logger.debug(`已抓取剪切板: ${url}，状态码: ${response.status}`);

      // 参考旧版后端的重定向处理逻辑
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (location) {
          if (location.includes('auth/login') || location.includes('login')) {
            return {
              success: false,
              message: '需要登录: 剪切板需要登录才能访问',
              statusCode: response.status
            };
          }
          return {
            success: false,
            message: `HTTP重定向: ${response.status} -> ${location}`,
            statusCode: response.status
          };
        }
      }

      // 参考旧版后端的HTTP状态码处理逻辑
      if (response.status !== 200) {
        if (response.status === 404) {
          return {
            success: false,
            message: '剪切板不存在或已被删除',
            statusCode: 404
          };
        } else if (response.status === 403 || response.status === 451) {
          return {
            success: false,
            message: '访问被拒绝: 剪切板可能受权限保护',
            statusCode: response.status
          };
        } else if (response.status === 401) {
          logger.debug(`Cookies 过期: ${updatedHeaders.Cookie}`);
          return {
            success: false,
            message: '需要登录: 认证已过期',
            statusCode: 401
          };
        } else {
          return {
            success: false,
            message: `HTTP错误: ${response.status}`,
            statusCode: response.status
          };
        }
      }

      const $ = cheerio.load(response.data);
      
      // 参考旧版后端的登录页面检测
      if ($('title').text().includes('登录') || $('input[name="username"]').length > 0) {
        return {
          success: false,
          message: '需要登录验证，请提供有效的Cookie',
          statusCode: 401
        };
      }

      // 使用旧版后端的通用获取处理器
      const pasteData = await this.commonFetchHandler(response, 'paste');
      
      if (pasteData) {
        const title = pasteData.title || '未命名剪切板';
        const content = pasteData.content || '';
        const authorUid = pasteData.author?.uid?.toString() || pasteData.userData?.uid || 'unknown';
        const authorName = pasteData.author?.name || pasteData.userData?.name || '未知作者';
        const createdAt = pasteData.time ? new Date(pasteData.time * 1000) : new Date();

        return {
          success: true,
          data: {
            luoguId: pasteId,
            title,
            content,
            authorUid,
            authorName,
            category: '未分类',
            publishedAt: createdAt,
            createdAt,
            updatedAt: new Date()
          }
        };
      }

      // 回退到contextElement解析（参考旧版后端的备用解析方法）
      const contextElement = $('#lentille-context');
      if (contextElement.length) {
        try {
          const dataObj = JSON.parse(contextElement.text().trim());
          const fallbackPasteData = dataObj.data?.paste;
          
          if (fallbackPasteData) {
            const title = fallbackPasteData.title || '未命名剪切板';
            const content = fallbackPasteData.content || '';
            const authorUid = fallbackPasteData.author?.uid?.toString() || 'unknown';
            const authorName = fallbackPasteData.author?.name || '未知作者';
            const createdAt = fallbackPasteData.time ? new Date(fallbackPasteData.time * 1000) : new Date();

            return {
              success: true,
              data: {
                luoguId: pasteId,
                title,
                content,
                authorUid,
                authorName,
                category: '未分类',
                publishedAt: createdAt,
                createdAt,
                updatedAt: new Date()
              }
            };
          }
        } catch (error) {
          logger.warn(`剪切板JSON解析失败: ${error}`);
        }
      }

      // 回退到HTML解析（参考旧版后端的最终解析方法）
      return this.parsePasteFromHTML($, pasteId);

    } catch (error: any) {
      logger.error(`爬取剪切板失败: ${pasteId}`, error);
      
      // 参考旧版后端的错误处理逻辑
      let errorMessage = '未知错误';
      
      try {
        if (error.response) {
          errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
        } else if (error.code === 'ECONNABORTED') {
          errorMessage = '请求超时';
        } else if (error.message && typeof error.message === 'string') {
          errorMessage = error.message;
        }
      } catch (e) {
        errorMessage = '网络请求失败';
      }
      
      return {
        success: false,
        message: errorMessage
      };
    }
  }

  private parsePasteFromHTML($: cheerio.CheerioAPI, pasteId: string): CrawlResult {
    // 提取剪切板标题 - 参考旧版后端的实现，尝试多种选择器
    let title = $('h1').first().text().trim();
    if (!title) {
      title = $('.paste-title').first().text().trim() || 
               $('.title').first().text().trim() || 
               '未命名剪切板';
    }
    
    // 提取剪切板内容 - 参考旧版后端的实现，尝试多种选择器
    let contentElement = $('.paste-content').first();
    if (!contentElement.length) {
      contentElement = $('pre').first();
    }
    if (!contentElement.length) {
      contentElement = $('code').first();
    }
    if (!contentElement.length) {
      contentElement = $('.content').first();
    }
    if (!contentElement.length) {
      contentElement = $('.paste').first();
    }
    
    if (!contentElement.length) {
      return {
        success: false,
        message: '无法找到剪切板内容',
        statusCode: 200
      };
    }

    // 清理内容 - 参考旧版后端的实现，进行更彻底的内容清理
    let content = contentElement.html() || contentElement.text() || '';
    
    // 移除HTML标签，保留纯文本内容
    content = content.replace(/<[^>]*>/g, '').trim();
    
    // 解码HTML实体
    content = content.replace(/&amp;/g, '&')
                     .replace(/&lt;/g, '<')
                     .replace(/&gt;/g, '>')
                     .replace(/&quot;/g, '"')
                     .replace(/&#39;/g, "'")
                     .replace(/&nbsp;/g, ' ');

    // 提取作者信息 - 参考旧版后端的实现，尝试多种选择器
    let authorElement = $('.user-name a').first();
    if (!authorElement.length) {
      authorElement = $('.author a').first();
    }
    if (!authorElement.length) {
      authorElement = $('.user a').first();
    }
    
    const authorName = authorElement.text().trim() || '未知作者';
    const authorUid = authorElement.attr('href')?.split('/').pop() || 'unknown';

    // 提取创建时间 - 参考旧版后端的实现，尝试多种选择器
    let timeElement = $('.paste-time').first();
    if (!timeElement.length) {
      timeElement = $('.time').first();
    }
    if (!timeElement.length) {
      timeElement = $('.created-at').first();
    }
    if (!timeElement.length) {
      timeElement = $('.date').first();
    }
    
    const timeText = timeElement.text().trim();
    const createdAt = this.parseTime(timeText) || new Date();

    return {
      success: true,
      data: {
        luoguId: pasteId,
        title,
        content,
        authorUid,
        authorName,
        category: '未分类',
        publishedAt: createdAt,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };
  }

  async savePasteFromTask(taskId: string): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      const task = await Task.findById(taskId);
      if (!task) {
        return {
          success: false,
          message: '任务不存在'
        };
      }

      if (task.status !== 'pending') {
        return {
          success: false,
          message: '任务状态不正确'
        };
      }

      // 开始处理任务
      task.status = 'processing';
      task.startedAt = new Date();
      await task.save();

      const pasteId = task.payload.url?.split('/').pop() || task.payload.articleId;
      if (!pasteId) {
        task.status = 'failed';
        task.completedAt = new Date();
        task.result = {
          success: false,
          error: '无法获取剪切板ID'
        };
        await task.save();
        
        return {
          success: false,
          message: '无法获取剪切板ID'
        };
      }

      const result = await this.crawlPaste(pasteId, task.payload.cookie);
      
      if (!result.success) {
        task.status = 'failed';
        task.completedAt = new Date();
        task.result = {
          success: false,
          error: result.message
        };
        await task.save();
        
        return {
          success: false,
          message: result.message || '爬取剪切板失败'
        };
      }

      const pasteData = result.data;
      
      if (!pasteData) {
        task.status = 'failed';
        task.completedAt = new Date();
        task.result = {
          success: false,
          error: '爬取结果数据为空'
        };
        await task.save();
        
        return {
          success: false,
          message: '爬取结果数据为空'
        };
      }
      
      // 检查是否已存在相同的剪切板
      const existingPaste = await Paste.findOne({ luoguId: pasteId });
      
      if (existingPaste) {
        // 更新现有剪切板
        existingPaste.title = pasteData.title;
        existingPaste.content = pasteData.content;
        existingPaste.authorUid = pasteData.authorUid;
        existingPaste.authorName = pasteData.authorName;
        existingPaste.publishedAt = pasteData.publishedAt;
        existingPaste.createdAt = pasteData.createdAt;
        existingPaste.updatedAt = new Date();
        existingPaste.crawledAt = new Date();
        existingPaste.status = 'completed';
        
        await existingPaste.save();
        
        task.status = 'completed';
        task.completedAt = new Date();
        task.result = {
          success: true,
          data: existingPaste
        };
        await task.save();
        
        return {
          success: true,
          message: '剪切板已更新',
          data: existingPaste
        };
      } else {
        // 创建新剪切板
        const newPaste = new Paste({
          luoguId: pasteId,
          title: pasteData.title,
          content: pasteData.content,
          authorUid: pasteData.authorUid,
          authorName: pasteData.authorName,
          publishedAt: pasteData.publishedAt,
          createdAt: pasteData.createdAt,
          updatedAt: new Date(),
          crawledAt: new Date(),
          status: 'completed'
        });
        
        await newPaste.save();
        
        task.status = 'completed';
        task.completedAt = new Date();
        task.result = {
          success: true,
          data: newPaste
        };
        await task.save();
        
        return {
          success: true,
          message: '剪切板已保存',
          data: newPaste
        };
      }
    } catch (error: any) {
      logger.error(`从任务保存剪切板失败: ${taskId}`, error);
      
      // 更新任务状态为失败
      try {
        const task = await Task.findById(taskId);
        if (task) {
          task.status = 'failed';
          task.completedAt = new Date();
          task.result = {
            success: false,
            error: String(error.message || '保存失败')
          };
          await task.save();
        }
      } catch (saveError) {
        logger.error('更新任务状态失败:', saveError);
      }
      
      return {
        success: false,
        message: error.message || '保存剪切板失败'
      };
    }
  }

  async savePasteDirectly(pasteId: string, cookie?: string): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      const result = await this.crawlPaste(pasteId, cookie);
      
      if (!result.success) {
        return {
          success: false,
          message: result.message || '爬取剪切板失败'
        };
      }

      const pasteData = result.data;
      
      if (!pasteData) {
        return {
          success: false,
          message: '爬取结果数据为空'
        };
      }
      
      // 检查是否已存在相同的剪切板
      const existingPaste = await Paste.findOne({ luoguId: pasteId });
      
      if (existingPaste) {
        // 更新现有剪切板
        existingPaste.title = pasteData.title;
        existingPaste.content = pasteData.content;
        existingPaste.authorUid = pasteData.authorUid;
        existingPaste.authorName = pasteData.authorName;
        existingPaste.publishedAt = pasteData.publishedAt;
        existingPaste.createdAt = pasteData.createdAt;
        existingPaste.updatedAt = new Date();
        existingPaste.crawledAt = new Date();
        existingPaste.status = 'completed';
        
        await existingPaste.save();
        
        return {
          success: true,
          message: '剪切板已更新',
          data: existingPaste
        };
      } else {
        // 创建新剪切板
        const newPaste = new Paste({
          luoguId: pasteId,
          title: pasteData.title,
          content: pasteData.content,
          authorUid: pasteData.authorUid,
          authorName: pasteData.authorName,
          publishedAt: pasteData.publishedAt,
          createdAt: pasteData.createdAt,
          updatedAt: new Date(),
          crawledAt: new Date(),
          status: 'completed'
        });
        
        await newPaste.save();
        
        return {
          success: true,
          message: '剪切板已保存',
          data: newPaste
        };
      }
    } catch (error: any) {
      logger.error(`直接保存剪切板失败: ${pasteId}`, error);
      
      return {
        success: false,
        message: error.message || '保存剪切板失败'
      };
    }
  }
}

export const crawlerService = new CrawlerService();