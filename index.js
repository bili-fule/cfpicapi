// index.js 
 
// --- 静态资源 (保持不变) ---
const STYLE_CSS = `
/* --- 复古终端风格样式 --- */
@import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');
* { box-sizing: border-box; }
body {
    background-color: #0d0d0d; color: #33ff33; font-family: 'VT323', monospace;
    font-size: 18px; line-height: 1.6; margin: 0; padding: 20px;
    text-shadow: 0 0 5px rgba(51, 255, 51, 0.4);
}
.container {
    max-width: 800px; margin: 0 auto; border: 2px solid #33ff33;
    padding: 15px 25px; box-shadow: 0 0 15px rgba(51, 255, 51, 0.3) inset;
}
header h1 { font-size: 2.5em; margin: 0; text-align: center; color: #aaffaa; }
#cursor { animation: blink 1s step-end infinite; display: inline-block; }
@keyframes blink { from, to { opacity: 1; } 50% { opacity: 0; } }
.subtitle { margin: 5px 0 20px 0; text-align: center; color: #88ff88; }
main { margin-top: 20px; }
fieldset { border: 1px dashed #33ff33; padding: 20px; margin-bottom: 30px; }
legend { color: #aaffaa; font-size: 1.5em; padding: 0 10px; text-transform: uppercase; }
h3 { color: #88ff88; margin-top: 0; }
ul { list-style-type: '>>> '; padding-left: 20px; }
li { margin-bottom: 20px; }
code {
    display: block; background-color: #1a1a1a; border: 1px solid #225522;
    padding: 10px; margin: 5px 0; color: #ffffff; word-wrap: break-word; text-shadow: none;
}
.count { color: #888; font-size: 0.9em; margin-left: 10px; }
.try-button {
    display: inline-block; color: #aaffaa; text-decoration: none; border: 1px solid #33ff33;
    padding: 3px 8px; margin-left: 10px; transition: all 0.2s;
}
.try-button:hover, .try-button:focus { background-color: #33ff33; color: #0d0d0d; text-shadow: none; }
.image-preview-container {
    padding: 15px; border: 1px solid #225522; background-color: #1a1a1a; margin: 20px 0;
}
.image-preview {
    border: 1px solid #33ff33; box-shadow: 0 0 10px rgba(51, 255, 51, 0.3);
    padding: 5px; background: #000;
}
.image-preview img { display: block; max-width: 100%; height: auto; }
small { color: #888; }
footer {
    text-align: center; margin-top: 30px; border-top: 1px dashed #33ff33;
    padding-top: 15px; font-size: 0.9em; color: #88ff88;
}`;

// --- 新增配置 ---
// 如果你的文件被上传到了一个额外的子目录中，请在这里指定它。
// 例如，如果你的存储桶是 'koishi'，文件路径是 'koishi/a_tag_name/...'，
// 那么这里就填 "koishi/"。
// 如果文件在根目录，就留空 ""。
const BASE_PATH_PREFIX = "koishi/";

// --- 配置区 (保持不变) ---
const AVAILABLE_ORIENTATIONS = ['horizontal', 'vertical', 'square'];

/**
 *  主 Worker 对象 (保持不变)
 */
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path === '/') return handleIndexRequest(request, env);
        if (path.startsWith('/api')) return handleApiRequest(request, env);
        if (path === '/style.css') return handleCssRequest();
        return new Response('Not Found', { status: 404 });
    },
};

/**
 * 处理器：处理 /style.css 请求
 */
function handleCssRequest() {
    return new Response(STYLE_CSS, {
        headers: {
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'public, max-age=86400' // 缓存一天
        }
    });
}

/**
 * 处理器：处理 / (首页) 请求
 * @param {Request} request
 * @param {object} env
 */
async function handleIndexRequest(request, env) {
    const bucket = env.IMAGE_BUCKET;
    if (!bucket) return new Response('Server configuration error: R2 bucket not bound.', { status: 500 });

    try {
        // --- 修改点 1：修改 list 逻辑以查找子目录中的标签 ---
        // 我们现在要列出 BASE_PATH_PREFIX 下的目录
        const listResult = await bucket.list({ prefix: BASE_PATH_PREFIX, delimiter: '/' });
        if (!listResult.delimitedPrefixes.length) {
            return new Response('Server configuration error: No tag directories found in bucket subdirectory.', { status: 500 });
        }
        
        // 从 "koishi/a_tag_name/" 中提取出 "a_tag_name"
        const fullTagPrefix = listResult.delimitedPrefixes[0]; // e.g., "koishi/a_tag_name/"
        const tagName = fullTagPrefix.substring(BASE_PATH_PREFIX.length).slice(0, -1);
        
        if (!tagName) {
             return new Response('Could not determine tag name from R2 structure.', { status: 500 });
        }

        // --- 修改点 2：在获取 manifest 时添加前缀 ---
        const manifestPromises = AVAILABLE_ORIENTATIONS.map(orient =>
            bucket.get(`${BASE_PATH_PREFIX}${tagName}/${orient}/manifest.json`)
        );
        const manifestResults = await Promise.all(manifestPromises);

        const imageCounts = {};
        let totalCount = 0;

        for (let i = 0; i < AVAILABLE_ORIENTATIONS.length; i++) {
            const orient = AVAILABLE_ORIENTATIONS[i];
            const manifest = manifestResults[i];
            let count = 0;
            if (manifest) {
                const imageList = await manifest.json();
                count = Array.isArray(imageList) ? imageList.length : 0;
            }
            imageCounts[orient] = count;
            totalCount += count;
        }

        const url = new URL(request.url);
        const apiBaseUrl = `${url.origin}/api`; // API的URL是相对于当前域的/api

        // 生成HTML
        const html = generateHtml({
            tagName: tagName,
            totalCount: totalCount,
            imageCounts: imageCounts,
            apiBaseUrl: apiBaseUrl,
        });

        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });

    } catch (e) {
        console.error(e);
        return new Response('Error fetching data for index page.', { status: 500 });
    }
}


/**
 * 处理器：处理 /api 请求
 * @param {Request} request
 * @param {object} env
 */
async function handleApiRequest(request, env) {
    const bucket = env.IMAGE_BUCKET;
    if (!bucket) return sendJsonError('R2 bucket not bound.', 500);

    try {
        // --- 修改点 3：同样修改 list 逻辑以查找子目录中的标签 ---
        const listResult = await bucket.list({ prefix: BASE_PATH_PREFIX, delimiter: '/' });
        if (!listResult.delimitedPrefixes.length) {
            return sendJsonError('图片库目录未找到或为空。', 500);
        }
        const fullTagPrefix = listResult.delimitedPrefixes[0];
        const tagName = fullTagPrefix.substring(BASE_PATH_PREFIX.length).slice(0, -1);
        
        if (!tagName) {
             return sendJsonError('Could not determine tag name from R2 structure.', 500);
        }

        // ... 获取 orientation 参数的逻辑保持不变 ...
        const url = new URL(request.url);
        const orientation = url.searchParams.get('orientation') || 'any';
        
        let finalImageName, finalImageOrientation;

        if (orientation === 'any') {
            const masterImageList = [];
            // --- 修改点 4：在获取所有 manifest 时添加前缀 ---
            const manifestPromises = AVAILABLE_ORIENTATIONS.map(orient =>
                bucket.get(`${BASE_PATH_PREFIX}${tagName}/${orient}/manifest.json`).then(obj => obj ? obj.json() : [])
            );
            const allLists = await Promise.all(manifestPromises);
            allLists.forEach((imageList, index) => {
                const orient = AVAILABLE_ORIENTATIONS[index];
                if (Array.isArray(imageList)) {
                    imageList.forEach(file => masterImageList.push({ file, orientation: orient }));
                }
            });

            if (masterImageList.length === 0) return sendJsonError('图片库中没有任何可用的图片。', 404);

            const randomEntry = masterImageList[Math.floor(Math.random() * masterImageList.length)];
            finalImageName = randomEntry.file;
            finalImageOrientation = randomEntry.orientation;
        } else {
            // --- 修改点 5：在获取特定 manifest 时添加前缀 ---
            const manifestKey = `${BASE_PATH_PREFIX}${tagName}/${orientation}/manifest.json`;
            const manifestObject = await bucket.get(manifestKey);
            if (!manifestObject) return sendJsonError(`指定的分类 '${orientation}' 不存在或缺少 manifest.json 文件。`, 404);

            const imageList = await manifestObject.json();
            if (!Array.isArray(imageList) || imageList.length === 0) return sendJsonError(`指定的分类 '${orientation}' 图片列表为空。`, 404);

            finalImageName = imageList[Math.floor(Math.random() * imageList.length)];
            finalImageOrientation = orientation;
        }

        // --- 修改点 6：在构建最终图片 Key 时添加前缀 ---
        const imageKey = `${BASE_PATH_PREFIX}${tagName}/${finalImageOrientation}/${finalImageName}`;
        const imageObject = await bucket.get(imageKey);
        
        if (imageObject === null) return sendJsonError(`选中的图片文件 '${finalImageName}' 不存在。`, 500);
        const headers = new Headers();
        imageObject.writeHttpMetadata(headers);
        headers.set('etag', imageObject.httpEtag);
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        headers.set('Pragma', 'no-cache');
        headers.set('Expires', '0');

        return new Response(imageObject.body, { headers });
    } catch (e) {
        console.error(e);
        return sendJsonError('服务器内部发生未知错误。', 500);
    }
}

// 确保把之前省略的函数也包含进来
/*
function handleCssRequest() { ... }
function sendJsonError(message, status = 400) { ... }
function generateHtml(data) { ... }
*/