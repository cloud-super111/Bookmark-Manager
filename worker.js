// Cloudflare Workers 脚本 - 书签同步API
// 直接复制粘贴到 Cloudflare Workers 编辑器中
// 记得在 Settings > Variables 中绑定 KV 命名空间 BOOKMARKS_KV

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS 支持
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // 处理 OPTIONS 请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    try {
      // 根据路径路由请求
      if (url.pathname === '/api/sync') {
        return await handleSync(request, env, corsHeaders);
      } else if (url.pathname === '/api/health') {
        return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        return new Response('Not Found', { 
          status: 404,
          headers: corsHeaders,
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

// 处理同步请求
async function handleSync(request, env, corsHeaders) {
  if (request.method === 'GET') {
    // 获取书签数据
    return await handlePull(request, env, corsHeaders);
  } else if (request.method === 'POST') {
    // 上传书签数据
    return await handlePush(request, env, corsHeaders);
  } else {
    return new Response('Method Not Allowed', { 
      status: 405,
      headers: corsHeaders,
    });
  }
}

// 拉取书签数据
async function handlePull(request, env, corsHeaders) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('deviceId');
  const action = url.searchParams.get('action');

  if (!deviceId) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Device ID required' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // 从 KV 存储获取全局书签数据
    const globalBookmarks = await env.BOOKMARKS_KV.get('global_bookmarks', 'json') || [];
    
    // 获取设备最后同步时间
    const deviceSyncTime = await env.BOOKMARKS_KV.get(`device_${deviceId}_last_sync`);
    
    // 如果有同步时间，只返回更新的书签
    let bookmarksToReturn = globalBookmarks;
    if (deviceSyncTime && action === 'pull') {
      const lastSyncDate = new Date(deviceSyncTime);
      bookmarksToReturn = globalBookmarks.filter(bookmark => 
        new Date(bookmark.updatedAt) > lastSyncDate
      );
    }

    return new Response(JSON.stringify({
      success: true,
      bookmarks: bookmarksToReturn,
      totalCount: globalBookmarks.length,
      deviceLastSync: deviceSyncTime,
      serverTime: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Pull error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Failed to pull bookmarks',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// 推送书签数据
async function handlePush(request, env, corsHeaders) {
  try {
    const data = await request.json();
    const { deviceId, bookmarks, timestamp, action } = data;

    if (!deviceId || !bookmarks) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Device ID and bookmarks required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 获取现有的全局书签
    const existingBookmarks = await env.BOOKMARKS_KV.get('global_bookmarks', 'json') || [];
    
    // 合并书签数据
    const mergedBookmarks = await mergeBookmarks(existingBookmarks, bookmarks, deviceId);
    
    // 保存合并后的书签到 KV
    await env.BOOKMARKS_KV.put('global_bookmarks', JSON.stringify(mergedBookmarks));
    
    // 更新设备最后同步时间
    await env.BOOKMARKS_KV.put(`device_${deviceId}_last_sync`, timestamp || new Date().toISOString());
    
    // 记录同步日志
    await logSyncActivity(env, deviceId, action, bookmarks.length);

    return new Response(JSON.stringify({
      success: true,
      message: 'Bookmarks synced successfully',
      bookmarks: mergedBookmarks,
      syncedCount: bookmarks.length,
      totalCount: mergedBookmarks.length,
      syncTime: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Push error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Failed to push bookmarks',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// 合并书签数据
async function mergeBookmarks(existingBookmarks, newBookmarks, deviceId) {
  const bookmarkMap = new Map();
  
  // 先添加现有书签
  existingBookmarks.forEach(bookmark => {
    bookmarkMap.set(bookmark.id, bookmark);
  });
  
  // 合并新书签
  newBookmarks.forEach(bookmark => {
    const existingBookmark = bookmarkMap.get(bookmark.id);
    
    if (!existingBookmark) {
      // 新书签，直接添加
      bookmarkMap.set(bookmark.id, {
        ...bookmark,
        syncedDevices: [deviceId],
        lastSyncTime: new Date().toISOString()
      });
    } else {
      // 现有书签，检查更新时间
      const existingTime = new Date(existingBookmark.updatedAt);
      const newTime = new Date(bookmark.updatedAt);
      
      if (newTime > existingTime) {
        // 新数据更新，使用新数据
        bookmarkMap.set(bookmark.id, {
          ...bookmark,
          syncedDevices: [...new Set([...(existingBookmark.syncedDevices || []), deviceId])],
          lastSyncTime: new Date().toISOString()
        });
      } else {
        // 旧数据，只更新同步设备列表
        bookmarkMap.set(bookmark.id, {
          ...existingBookmark,
          syncedDevices: [...new Set([...(existingBookmark.syncedDevices || []), deviceId])],
          lastSyncTime: new Date().toISOString()
        });
      }
    }
  });
  
  // 按创建时间排序，最新的在前面
  return Array.from(bookmarkMap.values()).sort((a, b) => 
    new Date(b.createdAt) - new Date(a.createdAt)
  );
}

// 记录同步活动日志
async function logSyncActivity(env, deviceId, action, count) {
  try {
    const logEntry = {
      deviceId,
      action,
      count,
      timestamp: new Date().toISOString(),
      userAgent: self.navigator?.userAgent || 'Unknown'
    };
    
    // 获取现有日志
    const existingLogs = await env.BOOKMARKS_KV.get('sync_logs', 'json') || [];
    
    // 添加新日志条目
    existingLogs.unshift(logEntry);
    
    // 保持最近1000条日志
    const trimmedLogs = existingLogs.slice(0, 1000);
    
    // 保存日志
    await env.BOOKMARKS_KV.put('sync_logs', JSON.stringify(trimmedLogs));
    
  } catch (error) {
    console.error('Failed to log sync activity:', error);
    // 日志记录失败不应该影响主要功能
  }
}
