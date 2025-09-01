#!/usr/bin/env node

/**
 * 智能导师套磁邮件系统 - 安装脚本
 * 自动检查系统环境并安装依赖
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkNodeVersion() {
    log('blue', '检查Node.js版本...');
    try {
        const version = process.version;
        const majorVersion = parseInt(version.slice(1).split('.')[0]);
        
        if (majorVersion < 14) {
            log('red', `❌ Node.js版本过低: ${version}`);
            log('yellow', '请安装Node.js 14.0或更高版本');
            log('blue', '下载地址: https://nodejs.org/');
            process.exit(1);
        }
        
        log('green', `✅ Node.js版本: ${version}`);
        return true;
    } catch (error) {
        log('red', '❌ 无法检测Node.js版本');
        return false;
    }
}

function checkNpm() {
    log('blue', '检查npm...');
    try {
        const version = execSync('npm --version', { encoding: 'utf8' }).trim();
        log('green', `✅ npm版本: ${version}`);
        return true;
    } catch (error) {
        log('red', '❌ npm未安装或不可用');
        return false;
    }
}

function checkFiles() {
    log('blue', '检查项目文件...');
    const requiredFiles = [
        'package.json',
        'email_server.js',
        'tutor_email_system.html'
    ];
    
    const missingFiles = [];
    
    for (const file of requiredFiles) {
        if (!fs.existsSync(file)) {
            missingFiles.push(file);
        }
    }
    
    if (missingFiles.length > 0) {
        log('red', `❌ 缺少必要文件: ${missingFiles.join(', ')}`);
        return false;
    }
    
    log('green', '✅ 所有必要文件存在');
    return true;
}

function installDependencies() {
    log('blue', '安装项目依赖...');
    try {
        log('yellow', '正在运行: npm install');
        execSync('npm install', { stdio: 'inherit' });
        log('green', '✅ 依赖安装完成');
        return true;
    } catch (error) {
        log('red', '❌ 依赖安装失败');
        log('red', error.message);
        return false;
    }
}

function createEnvFile() {
    log('blue', '创建环境配置文件...');
    
    if (fs.existsSync('.env')) {
        log('yellow', '⚠️  .env文件已存在，跳过创建');
        return true;
    }
    
    if (fs.existsSync('.env.example')) {
        try {
            fs.copyFileSync('.env.example', '.env');
            log('green', '✅ 已从.env.example创建.env文件');
            log('yellow', '请根据需要修改.env文件中的配置');
            return true;
        } catch (error) {
            log('red', '❌ 创建.env文件失败');
            return false;
        }
    } else {
        log('yellow', '⚠️  .env.example文件不存在，跳过环境配置');
        return true;
    }
}

function createUploadsDir() {
    log('blue', '创建上传目录...');
    
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
        try {
            fs.mkdirSync(uploadDir, { recursive: true });
            log('green', `✅ 创建上传目录: ${uploadDir}`);
        } catch (error) {
            log('red', `❌ 创建上传目录失败: ${error.message}`);
            return false;
        }
    } else {
        log('green', '✅ 上传目录已存在');
    }
    
    return true;
}

function showUsageInstructions() {
    log('green', '\n🎉 安装完成！');
    log('blue', '\n使用说明:');
    log('yellow', '1. 启动服务器:');
    log('reset', '   npm start');
    log('reset', '   或者: node email_server.js');
    log('yellow', '\n2. 打开浏览器访问:');
    log('reset', '   http://localhost:3000/tutor_email_system.html');
    log('yellow', '\n3. 邮箱配置建议:');
    log('reset', '   - 使用QQ邮箱: smtp.qq.com:587');
    log('reset', '   - 使用授权码而不是登录密码');
    log('reset', '   - 确保开启SMTP服务');
    log('yellow', '\n4. 更多帮助:');
    log('reset', '   查看README.md文件获取详细说明');
    log('blue', '\n祝您使用愉快！');
}

function main() {
    log('green', '='.repeat(50));
    log('green', '智能导师套磁邮件系统 - 安装向导');
    log('green', '='.repeat(50));
    
    // 检查系统环境
    if (!checkNodeVersion()) return;
    if (!checkNpm()) return;
    if (!checkFiles()) return;
    
    // 安装和配置
    if (!installDependencies()) return;
    if (!createEnvFile()) return;
    if (!createUploadsDir()) return;
    
    // 显示使用说明
    showUsageInstructions();
}

// 运行安装脚本
if (require.main === module) {
    main();
}

module.exports = { main };