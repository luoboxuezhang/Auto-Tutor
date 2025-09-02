const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

// 加载环境变量
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// 配置常量
const CONFIG = {
    PORT: port,
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
    MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB) || 10,
    MAX_EMAIL_CONTENT_LENGTH: parseInt(process.env.MAX_EMAIL_CONTENT_LENGTH) || 50000,
    MAX_EMAIL_SUBJECT_LENGTH: parseInt(process.env.MAX_EMAIL_SUBJECT_LENGTH) || 200,
    FETCH_TIMEOUT_MS: parseInt(process.env.FETCH_TIMEOUT_MS) || 30000,
    MAX_CONTENT_SIZE_MB: parseInt(process.env.MAX_CONTENT_SIZE_MB) || 5,
    MAX_CONTENT_LENGTH: parseInt(process.env.MAX_CONTENT_LENGTH) || 3000,
    UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
    LOG_DIR: process.env.LOG_DIR || 'log',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    ENABLE_ACCESS_LOG: process.env.ENABLE_ACCESS_LOG === 'true'
};

// 日志函数
function log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const currentLevel = levels[CONFIG.LOG_LEVEL] || 2;
    
    if (levels[level] <= currentLevel) {
        console[level](`[${timestamp}] [${level.toUpperCase()}]`, message, ...args);
    }
}

// 创建uploads目录
if (!fs.existsSync(CONFIG.UPLOAD_DIR)) {
    fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
    log('info', `创建上传目录: ${CONFIG.UPLOAD_DIR}`);
}
// 创建log目录
if (!fs.existsSync(CONFIG.LOG_DIR)) {
    fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true });
    log('info', `创建日志目录: ${CONFIG.LOG_DIR}`);
}

// 速率限制
const limiter = rateLimit({
    windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
    max: CONFIG.RATE_LIMIT_MAX_REQUESTS,
    message: { success: false, message: '请求过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false
});

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));
app.use('/api/', limiter);

// 文件上传配置
const upload = multer({ 
    dest: CONFIG.UPLOAD_DIR + '/',
    limits: {
        fileSize: CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024,
        files: 20
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'application/pdf').split(',');
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`只允许上传以下格式的文件: ${allowedTypes.join(', ')}`));
        }
    }
});

// 输入验证函数
function validateEmailInput(data) {
    const { to, subject, body, senderEmail, senderPassword, smtpServer, smtpPort } = data;
    
    if (!to || !subject || !body || !senderEmail || !senderPassword || !smtpServer || !smtpPort) {
        throw new Error('缺少必要的邮件参数');
    }
    
    // 邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to) || !emailRegex.test(senderEmail)) {
        throw new Error('邮箱格式不正确');
    }
    
    // 端口验证
    const port = parseInt(smtpPort);
    if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error('SMTP端口号无效');
    }
    
    // 主题和内容长度限制
    if (subject.length > CONFIG.MAX_EMAIL_SUBJECT_LENGTH) {
        throw new Error(`邮件主题过长（最多${CONFIG.MAX_EMAIL_SUBJECT_LENGTH}字符）`);
    }
    
    if (body.length > CONFIG.MAX_EMAIL_CONTENT_LENGTH) {
        throw new Error(`邮件内容过长（最多${CONFIG.MAX_EMAIL_CONTENT_LENGTH}字符）`);
    }
    
    return true;
}

// 安全处理文件/目录名
function sanitizeForPath(name) {
    return (name || '')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// 修复浏览器上传中文文件名被按 Latin1 解读导致的乱码（例如显示为 “ä¸­å…”）
// 思路：尝试用 latin1 -> utf8 纠正；若纠正后含中日韩字符且原字符串疑似乱码，则采用纠正结果
function fixFilenameEncoding(name) {
    if (!name) return name;
    try {
        const decoded = Buffer.from(name, 'latin1').toString('utf8');
        const hasCJK = /[\u3400-\u9FFF]/.test(decoded);
        const origHasCJK = /[\u3400-\u9FFF]/.test(name);
        const looksMojibake = /[ÃÂåäæçèéíóú]/.test(name); // 常见 UTF-8 被当作 Latin1 的伪影
        if ((hasCJK && !origHasCJK) || looksMojibake) {
            return decoded;
        }
    } catch (e) {
        // 忽略ncorrect
    }
    return name;
}

// 邮件发送接口
app.post('/api/send-email', upload.fields([
    { name: 'resume', maxCount: 1 },
    { name: 'transcript', maxCount: 1 },
    { name: 'attachments', maxCount: 15 }
]), async (req, res) => {
    const startTime = Date.now();
    // 记录所有上传的临时文件路径，便于统一清理
    const uploadedFiles = [];
    
    try {
        // 输入验证
        validateEmailInput(req.body);
        
        const {
            to,
            subject,
            body,
            senderEmail,
            senderPassword,
            smtpServer,
            smtpPort
        } = req.body;

        const senderName = (req.body.senderName || '').trim();
        const tutorNameRaw = (req.body.tutorName || '').trim();
        const emailLanguage = (req.body.emailLanguage || '').trim();

        // 收集上传的文件（简历、成绩单、其他附件）
        const files = req.files || {};
        const resumeFiles = files.resume || [];
        const transcriptFiles = files.transcript || [];
        const otherFiles = files.attachments || [];
        [ ...resumeFiles, ...transcriptFiles, ...otherFiles ].forEach(f => {
            if (f && f.path) uploadedFiles.push(f.path);
        });
        
        log('info', `开始发送邮件: ${senderEmail} -> ${to}`);

        // 创建邮件传输器
        const transporter = nodemailer.createTransport({
            host: smtpServer,
            port: parseInt(smtpPort),
            secure: parseInt(smtpPort) === 465, // 465端口使用SSL
            auth: {
                user: senderEmail,
                pass: senderPassword
            },
            tls: {
                rejectUnauthorized: false
            },
            connectionTimeout: 60000, // 60秒连接超时
            greetingTimeout: 30000, // 30秒问候超时
            socketTimeout: 60000 // 60秒socket超时
        });

        // 验证SMTP连接
        await transporter.verify();
        log('debug', 'SMTP连接验证成功');

        // 将纯文本换行转换为HTML段落与换行，避免“没有格式”。
        const escapeHtml = (s) => s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const toHtml = (text) => {
            const escaped = escapeHtml(text || '');
            // 先按双换行切段，段内的单换行转成 <br>
            return escaped
                .split(/\n\s*\n/g)
                .map(p => `<p style="margin:0 0 12px 0; line-height:1.6;">${p.replace(/\n/g, '<br>')}</p>`) 
                .join('');
        };

        const htmlBody = toHtml(body);

        // RFC5987 编码工具，保障中文等非ASCII文件名在多数客户端正确显示
        const encodeRFC5987 = (str) => encodeURIComponent(str)
            .replace(/['()]/g, escape)
            .replace(/\*/g, '%2A');
        const asciiFallback = (str, fallback = 'attachment.pdf') => {
            const ascii = str.replace(/[\u0080-\uFFFF]/g, '');
            return ascii && /[\w\.-]/.test(ascii) ? ascii : fallback;
        };

        // 邮件选项
        const mailOptions = {
            from: `${senderName ? '"' + senderName + '" ' : ''}<${senderEmail}>`,
            to: to,
            subject: subject,
            html: htmlBody,
            text: body
        };

        // 组装附件：简历、成绩单、其他PDF（带 contentDisposition，包含 filename* 为 UTF-8）
        const attachments = [];
        if (resumeFiles[0]) {
            const name = fixFilenameEncoding(resumeFiles[0].originalname || 'resume.pdf');
            attachments.push({
                filename: name,
                path: resumeFiles[0].path,
                contentType: 'application/pdf',
                contentDisposition: `attachment; filename="${asciiFallback(name, 'resume.pdf')}"; filename*=UTF-8''${encodeRFC5987(name)}`
            });
            log('debug', `已添加简历: ${name}`);
        }
        if (transcriptFiles[0]) {
            const name = fixFilenameEncoding(transcriptFiles[0].originalname || 'transcript.pdf');
            attachments.push({
                filename: name,
                path: transcriptFiles[0].path,
                contentType: 'application/pdf',
                contentDisposition: `attachment; filename="${asciiFallback(name, 'transcript.pdf')}"; filename*=UTF-8''${encodeRFC5987(name)}`
            });
            log('debug', `已添加成绩单: ${name}`);
        }
        if (otherFiles && otherFiles.length) {
            otherFiles.forEach((f, idx) => {
                const name = fixFilenameEncoding(f.originalname || `attachment_${idx + 1}.pdf`);
                attachments.push({
                    filename: name,
                    path: f.path,
                    contentType: 'application/pdf',
                    contentDisposition: `attachment; filename="${asciiFallback(name, `attachment_${idx + 1}.pdf`)}"; filename*=UTF-8''${encodeRFC5987(name)}`
                });
            });
            log('debug', `已添加其他PDF数量: ${otherFiles.length}`);
        }
        if (attachments.length) {
            mailOptions.attachments = attachments;
        }

        // 发送邮件
        const info = await transporter.sendMail(mailOptions);
        
        const duration = Date.now() - startTime;
        log('info', `邮件发送成功: ${info.messageId}, 耗时: ${duration}ms`);

        // 写入本地日志：每位导师一个文件夹 log/xx导师
        try {
            let tutorDirName = sanitizeForPath(tutorNameRaw) || sanitizeForPath(to.split('@')[0]);
            if (!/导师$/.test(tutorDirName)) {
                tutorDirName += '导师';
            }
            tutorDirName = tutorDirName || '未知导师';

            const tutorDir = path.join(CONFIG.LOG_DIR, tutorDirName);
            fs.mkdirSync(tutorDir, { recursive: true });

            const ts = new Date().toISOString().replace(/[:]/g, '-');
            const safeSubject = sanitizeForPath(subject).slice(0, 60) || '邮件';
            const logFilename = `${ts}_${safeSubject}.json`;
            const logPath = path.join(tutorDir, logFilename);

            const logData = {
                timestamp: new Date().toISOString(),
                messageId: info.messageId || '',
                durationMs: duration,
                to,
                tutorName: tutorNameRaw,
                from: mailOptions.from,
                language: emailLanguage,
                subject,
                body,
                html: htmlBody,
                attachments: (attachments || []).map(a => ({ filename: a.filename }))
            };
            fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), 'utf8');
            log('info', `已保存邮件日志: ${logPath}`);
        } catch (logErr) {
            log('warn', '写入邮件日志失败:', logErr.message);
        }
        
        // 清理所有上传的临时文件
        uploadedFiles.forEach(p => {
            if (p && fs.existsSync(p)) {
                try { fs.unlinkSync(p); } catch (e) { log('warn', `清理临时文件失败: ${p} -> ${e.message}`); }
            }
        });
        
        res.json({ 
            success: true, 
            message: '邮件发送成功',
            messageId: info.messageId,
            duration: duration
        });

    } catch (error) {
        const duration = Date.now() - startTime;
        log('error', `邮件发送失败 (耗时: ${duration}ms):`, error.message);
        
        // 清理所有上传的临时文件
        uploadedFiles.forEach(p => {
            if (p && fs.existsSync(p)) {
                try { fs.unlinkSync(p); } catch (e) { log('warn', `清理临时文件失败: ${p} -> ${e.message}`); }
            }
        });
        
        // 根据错误类型返回不同的状态码
        let statusCode = 500;
        let errorMessage = error.message;
        
        if (error.message.includes('缺少必要') || error.message.includes('格式不正确') || error.message.includes('无效')) {
            statusCode = 400; // 客户端错误
        } else if (error.message.includes('认证失败') || error.message.includes('Authentication')) {
            statusCode = 401; // 认证错误
            errorMessage = 'SMTP认证失败，请检查邮箱和密码';
        } else if (error.message.includes('连接') || error.message.includes('timeout')) {
            statusCode = 503; // 服务不可用
            errorMessage = 'SMTP服务器连接失败，请检查服务器设置';
        }
        
        res.status(statusCode).json({ 
            success: false, 
            message: errorMessage,
            duration: duration
        });
    }
});

// 网页内容获取接口
app.get('/api/fetch-website', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { url } = req.query;
        
        // 输入验证
        if (!url) {
            return res.status(400).json({ 
                success: false, 
                message: '缺少URL参数' 
            });
        }
        
        // URL格式验证
        let validUrl;
        try {
            validUrl = new URL(url);
            if (!['http:', 'https:'].includes(validUrl.protocol)) {
                throw new Error('只支持HTTP和HTTPS协议');
            }
        } catch (urlError) {
            return res.status(400).json({ 
                success: false, 
                message: 'URL格式无效: ' + urlError.message 
            });
        }
        
        log('info', `开始获取网页内容: ${url}`);
        
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch(url, {
            timeout: CONFIG.FETCH_TIMEOUT_MS,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            follow: 5, // 最多跟随5次重定向
            size: CONFIG.MAX_CONTENT_SIZE_MB * 1024 * 1024
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
            throw new Error('不支持的内容类型: ' + contentType);
        }
        
        const text = await response.text();
        
        // 简单提取文本内容
        const textContent = text
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // 移除script标签
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // 移除style标签
            .replace(/<[^>]*>/g, ' ') // 移除HTML标签
            .replace(/\s+/g, ' ') // 合并空白字符
            .trim()
            .substring(0, CONFIG.MAX_CONTENT_LENGTH);
        
        const duration = Date.now() - startTime;
        log('info', `网页内容获取成功, 内容长度: ${textContent.length}, 耗时: ${duration}ms`);
        
        res.json({ 
            success: true, 
            content: textContent,
            url: url,
            contentLength: textContent.length,
            duration: duration
        });
        
    } catch (error) {
        const duration = Date.now() - startTime;
        log('error', `网页获取失败 (耗时: ${duration}ms):`, error.message);
        
        let statusCode = 500;
        let errorMessage = error.message;
        
        if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
            statusCode = 504; // 网关超时
            errorMessage = '网页请求超时，请稍后重试';
        } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
            statusCode = 502; // 网关错误
            errorMessage = '无法连接到目标网站';
        } else if (error.message.includes('HTTP 4')) {
            statusCode = 404; // 客户端错误
            errorMessage = '网页不存在或无法访问';
        }
        
        res.status(statusCode).json({ 
            success: false, 
            message: errorMessage,
            duration: duration
        });
    }
});

app.listen(CONFIG.PORT, () => {
    log('info', `邮件服务器运行在 http://localhost:${CONFIG.PORT}`);
    log('info', `请在浏览器中打开 http://localhost:${CONFIG.PORT}/tutor_email_system.html`);
    log('info', `环境: ${process.env.NODE_ENV || 'development'}`);
    log('info', `日志级别: ${CONFIG.LOG_LEVEL}`);
    log('info', `上传目录: ${CONFIG.UPLOAD_DIR}`);
    log('info', `速率限制: ${CONFIG.RATE_LIMIT_MAX_REQUESTS}次/${CONFIG.RATE_LIMIT_WINDOW_MS/1000/60}分钟`);
});

// 优雅关闭
process.on('SIGTERM', () => {
    log('info', '收到SIGTERM信号，正在关闭服务器...');
    process.exit(0);
});

process.on('SIGINT', () => {
    log('info', '收到SIGINT信号，正在关闭服务器...');
    process.exit(0);
});