// Cloudflare Workers 脚本 - 书签同步API（完整版）
// 直接复制粘贴到 Cloudflare Workers 编辑器中
// 记得在 Settings > Variables 中绑定 KV 命名空间 BOOKMARKS_KV

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 增强的 CORS 支持
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    };

    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      if (url.pathname === '/api/sync') {
        return await handleSync(request, env, corsHeaders);
      } else if (url.pathname === '/api/health') {
        return handleHealth(corsHeaders);
      } else if (url.pathname === '/api/stats') {
        return await handleStats(request, env, corsHeaders);
      } else if (url.pathname === '/' || url.pathname === '/index.html') {
        return handleWelcome(corsHeaders);
      } else {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'Not Found',
          message: '请求的端点不存在'
        }), { 
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Internal Server Error',
        message: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

// 欢迎页面
function handleWelcome(corsHeaders) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>书签同步 API</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 20px;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 600px;
    }
    h1 { color: #667eea; margin-bottom: 20px; }
    .status { 
      display: inline-block;
      padding: 8px 16px;
      background: #d4edda;
      color: #155724;
      border-radius: 20px;
      font-weight: bold;
      margin-bottom: 20px;
    }
    .endpoint {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      margin: 10px 0;
      border-left: 4px solid #667eea;
    }
    .endpoint code {
      background: #e9ecef;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
    .method {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 12px;
      margin-right: 10px;
    }
    .get { background: #28a745; color: white; }
    .post { background: #007bff; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔖 书签同步 API</h1>
    <div class="status">✅ 服务运行中</div>
    
    <h3>可用端点：</h3>
    
    <div class="endpoint">
      <span class="method get">GET</span>
      <strong>/api/health</strong>
      <p>健康检查端点，返回服务状态</p>
    </div>
    
    <div class="endpoint">
      <span class="method get">GET</span>
      <strong>/api/sync?username=用户名</strong>
      <p>拉取指定用户的书签数据</p>
    </div>
    
    <div class="endpoint">
      <span class="method post">POST</span>
      <strong>/api/sync</strong>
      <p>推送书签数据到云端</p>
      <p>请求体: <code>{ "username": "用户名", "bookmarks": [], "folders": [] }</code></p>
    </div>
    
    <div class="endpoint">
      <span class="method get">GET</span>
      <strong>/api/stats</strong>
      <p>获取系统统计信息</p>
    </div>
    
    <p style="margin-top: 30px; color: #6c757d; font-size: 14px;">
      📝 此 API 支持多用户书签同步<br>
      🔒 当前版本：无身份验证（请在生产环境中添加身份验证）
    </p>
  </div>
</body>
</html>`;
  
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
    },
  });
}

// 健康检查
function handleHealth(corsHeaders) {
  return new Response(JSON.stringify({ 
    status: 'ok',
    service: 'Bookmark Sync API',
    version: '2.2.0',
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// 处理同步请求
async function handleSync(request, env, corsHeaders) {
  if (request.method === 'GET') {
    return await handlePull(request, env, corsHeaders);
  } else if (request.method === 'POST') {
    return await handlePush(request, env, corsHeaders);
  } else {
    return new Response(JSON.stringify({
      success: false,
      error: 'Method Not Allowed'
    }), { 
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// 拉取数据
async function handlePull(request, env, corsHeaders) {
  const url = new URL(request.url);
  const username = url.searchParams.get('username');

  if (!username) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Username required',
      message: '缺少用户名参数'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const userKey = `user_${username}`;
    const userData = await env.BOOKMARKS_KV.get(userKey, 'json');
    
    if (!userData) {
      return new Response(JSON.stringify({
        success: true,
        bookmarks: [],
        folders: [],
        lastSync: null,
        message: '该用户还没有云端数据'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      bookmarks: userData.bookmarks || [],
      folders: userData.folders || [],
      lastSync: userData.lastSync || null,
      syncTime: userData.syncTime || null,
      bookmarksCount: (userData.bookmarks || []).length,
      foldersCount: (userData.folders || []).length
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Pull error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Failed to pull data',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// 推送数据
async function handlePush(request, env, corsHeaders) {
  try {
    const data = await request.json();
    const { username, bookmarks, folders } = data;

    if (!username) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Username required',
        message: '缺少用户名参数'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!bookmarks) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Bookmarks required',
        message: '缺少书签数据'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 验证数据格式
    if (!Array.isArray(bookmarks)) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Invalid data format',
        message: 'bookmarks 必须是数组'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userKey = `user_${username}`;
    const syncTime = new Date().toISOString();
    
    const userData = {
      username: username,
      bookmarks: bookmarks,
      folders: folders || [],
      lastSync: syncTime,
      syncTime: syncTime,
      updatedAt: syncTime,
      bookmarksCount: bookmarks.length,
      foldersCount: (folders || []).length
    };

    // 保存到 KV
    await env.BOOKMARKS_KV.put(userKey, JSON.stringify(userData));

    return new Response(JSON.stringify({
      success: true,
      message: '数据同步成功',
      username: username,
      bookmarksCount: bookmarks.length,
      foldersCount: (folders || []).length,
      syncTime: syncTime
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Push error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Failed to push data',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// 统计信息
async function handleStats(request, env, corsHeaders) {
  try {
    // 获取所有用户的统计信息
    const list = await env.BOOKMARKS_KV.list({ prefix: 'user_' });
    
    let totalUsers = 0;
    let totalBookmarks = 0;
    let totalFolders = 0;
    
    for (const key of list.keys) {
      totalUsers++;
      try {
        const userData = await env.BOOKMARKS_KV.get(key.name, 'json');
        if (userData) {
          totalBookmarks += (userData.bookmarks || []).length;
          totalFolders += (userData.folders || []).length;
        }
      } catch (e) {
        console.error('Error reading user data:', e);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      stats: {
        totalUsers: totalUsers,
        totalBookmarks: totalBookmarks,
        totalFolders: totalFolders,
        timestamp: new Date().toISOString()
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Stats error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Failed to get stats',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}