// main.js - 悬浮球插件，支持上下文读取、API 设置、内容生成
(function() {
    let isDragging = false;
    let dragOffsetX = 0, dragOffsetY = 0;
    let startX, startY;
    const clickThreshold = 5;
    let modalWindow = null;

    // ========== 配置管理 ==========
    const DEFAULT_CONFIG = {
        apiBase: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-3.5-turbo'
    };

    function getConfig() {
        try {
            const saved = localStorage.getItem('floating-ball-config');
            return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : { ...DEFAULT_CONFIG };
        } catch (e) {
            return { ...DEFAULT_CONFIG };
        }
    }

    function saveConfig(config) {
        localStorage.setItem('floating-ball-config', JSON.stringify(config));
    }

    // ========== 上下文获取 ==========
    function getLatestContext() {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                return SillyTavern.getContext();
            }
        } catch(e) {
            console.error('[悬浮球] 获取上下文失败', e);
        }
        return null;
    }

    function getWorldInfoCount() {
        const ctx = getLatestContext();
        if (!ctx) return 0;
        let count = 0;
        if (ctx.worldInfo && Array.isArray(ctx.worldInfo.entries)) {
            count += ctx.worldInfo.entries.length;
        } else if (ctx.globalWorldInfo && Array.isArray(ctx.globalWorldInfo.entries)) {
            count += ctx.globalWorldInfo.entries.length;
        }
        try {
            const char = ctx.characters && ctx.characters[ctx.characterId];
            if (char) {
                if (char.data && char.data.character_book && Array.isArray(char.data.character_book.entries)) {
                    count += char.data.character_book.entries.length;
                } else if (char.worldInfo && Array.isArray(char.worldInfo.entries)) {
                    count += char.worldInfo.entries.length;
                } else if (char.data && char.data.worldInfo && Array.isArray(char.data.worldInfo.entries)) {
                    count += char.data.worldInfo.entries.length;
                }
            }
        } catch (e) { console.warn('[悬浮球] 角色世界书读取异常', e); }
        return count;
    }

    // 统一聊天历史格式
    function getChatHistory() {
        const ctx = getLatestContext();
        if (!ctx || !ctx.chat || !Array.isArray(ctx.chat)) return [];
        return ctx.chat.map(msg => ({
            role: msg.is_user ? 'user' : 'assistant',
            content: msg.mes || msg.content || '',
            name: msg.name || ''
        }));
    }

    // 获取角色和用户名
    function getCharAndUser() {
        const ctx = getLatestContext();
        let charName = '未知角色';
        let userName = '用户';
        if (ctx) {
            if (ctx.characterId !== undefined && ctx.characters && ctx.characters[ctx.characterId]) {
                charName = ctx.characters[ctx.characterId].name || '未知角色';
            } else if (ctx.name2) {
                charName = ctx.name2;
            }
            userName = ctx.name1 || '用户';
        }
        return { charName, userName };
    }

    // ========== UI 部分 ==========
    function refreshDebugInfo() {
        const ctx = getLatestContext();
        if (!ctx) return;

        const { charName, userName } = getCharAndUser();
        const worldCount = getWorldInfoCount();
        const chatHistory = getChatHistory();
        const chatCount = chatHistory.length;

        // 不再更新页面元素，仅控制台输出
        console.log('[悬浮球] 上下文信息', { charName, userName, worldCount, chatCount });
    }

    function showModal() {
        if (!modalWindow) createModal();
        modalWindow.classList.remove('modal-hidden');
        modalWindow.classList.add('modal-visible');
        constrainModalBounds();
    }

    function hideModal() {
        if (modalWindow) {
            modalWindow.classList.remove('modal-visible');
            modalWindow.classList.add('modal-hidden');
        }
    }

    function toggleModal() {
        if (!modalWindow) {
            createModal();
            showModal();
        } else if (modalWindow.classList.contains('modal-hidden')) {
            showModal();
        } else {
            hideModal();
        }
    }

    function constrainModalBounds() {
        if (!modalWindow) return;
        const rect = modalWindow.getBoundingClientRect();
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        let left = parseFloat(modalWindow.style.left);
        let top = parseFloat(modalWindow.style.top);
        if (isNaN(left)) left = (winW - rect.width) / 2;
        if (isNaN(top)) top = (winH - rect.height) / 2;
        left = Math.min(Math.max(0, left), winW - rect.width);
        top = Math.min(Math.max(0, top), winH - rect.height);
        modalWindow.style.left = left + 'px';
        modalWindow.style.top = top + 'px';
    }

    // ========== API 调用 ==========
    async function callAI(promptText) {
    const config = getConfig();
    if (!config.apiKey) throw new Error('请先设置 API Key');

    let response;
    try {
        response = await fetch(`${config.apiBase}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: 'system', content: '你是一个创意内容生成器。你必须只返回一个有效的JSON数组，不要有任何额外解释、标点或代码块。' },
                    { role: 'user', content: promptText }   // ← 这一行是关键
                ],
                temperature: 0.8,
                max_tokens: 2000
            })
        });
    } catch (e) {
        throw new Error(`网络请求失败：${e.message}。请检查 API 地址或网络连接。`);
    }

    if (!response.ok) {
        let errorMsg = `API 返回错误 ${response.status}`;
        try {
            const errBody = await response.json();
            if (errBody.error?.message) errorMsg = errBody.error.message;
        } catch {}
        throw new Error(errorMsg);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0]?.message?.content) {
        throw new Error('API 返回格式异常，未找到生成内容');
    }

    const rawContent = data.choices[0].message.content.trim();
    console.log('[悬浮球] AI 原始返回:', rawContent);

        let jsonStr = null;
        const codeBlockMatch = rawContent.match(/```json\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
        
        if (!jsonStr) {
            const arrayMatch = rawContent.match(/\[\s*\{[\s\S]*?\}\s*\]/);
            const objMatch = rawContent.match(/\{\s*"[\s\S]*?\}\s*\}/);
            jsonStr = arrayMatch ? arrayMatch[0] : (objMatch ? objMatch[0] : null);
        }

        if (!jsonStr) jsonStr = rawContent;

        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error('[悬浮球] JSON 解析失败，原始内容:', rawContent);
            try {
                const fixed = jsonStr.replace(/,\s*([}\]])/g, '$1');
                return JSON.parse(fixed);
            } catch (e2) {
                throw new Error(`JSON解析失败。AI返回内容预览：${rawContent.substring(0, 300)}...`);
            }
        }
    }

    // ========== 生成内容 ==========
    function buildWorldNewsPrompt() {
        const ctx = getLatestContext();
        const { charName, userName } = getCharAndUser();
        const chatHistory = getChatHistory().slice(-6).map(m => `${m.name || m.role}: ${m.content}`).join('\n');
        
        const worldEntries = [];
        try {
            const char = ctx.characters?.[ctx.characterId];
            if (char?.data?.character_book?.entries) {
                char.data.character_book.entries.forEach(e => worldEntries.push(`${e.key}: ${e.content}`));
            }
        } catch(e) {}

        const styleInstruction = `请严格根据提供的世界观描述，推断故事的整体风格和语言特点，并在生成新闻时完全使用该风格的文风。例如：中国古代江湖背景使用半文半白、简洁雅致的中文；西方奇幻使用翻译腔，带有欧美小说的句式；现代都市使用流畅口语或新闻报道体；科幻未来可带科技感。务必让读者能通过文字感受到这个世界的气氛。`;

        return `基于以下世界观和最近聊天记录，生成三条今日《世界报》头条新闻（JSON数组，每项包含title、summary、source字段）。
${styleInstruction}
世界观条目：${worldEntries.join('; ') || '无特殊设定'}
角色：${charName}，用户：${userName}
最近对话：${chatHistory || '无'}`;
    }

    function buildLocalNewsPrompt() {
        const ctx = getLatestContext();
        const { charName } = getCharAndUser();
        const chatHistory = getChatHistory().slice(-4).map(m => `${m.name || m.role}: ${m.content}`).join('\n');
        
        const worldEntries = [];
        try {
            const char = ctx.characters?.[ctx.characterId];
            if (char?.data?.character_book?.entries) {
                char.data.character_book.entries.forEach(e => worldEntries.push(`${e.key}: ${e.content}`));
            }
        } catch(e) {}

        const styleInstruction = `请严格根据提供的世界观描述，推断故事的整体风格和语言特点，并在生成本地新闻时完全使用该风格的文风。例如：中国古代江湖背景使用半文半白、简洁雅致的中文；西方奇幻使用翻译腔，带有欧美小说的句式；现代都市使用流畅口语或新闻报道体；科幻未来可带科技感。务必让读者能通过文字感受到这个世界的气氛。`;

        return `基于当前角色所在地区和环境，生成三条本地新闻（JSON数组，每项包含title、content、location字段）。
${styleInstruction}
世界观：${worldEntries.join('; ') || '无特殊设定'}
角色：${charName}
最近事件：${chatHistory || '无'}`;
    }

    function buildSocialMediaPrompt() {
        const ctx = getLatestContext();
        const { charName, userName } = getCharAndUser();
        const chatHistory = getChatHistory().slice(-8);
        
        const messages = chatHistory.map(m => `${m.name || m.role}: ${m.content}`).join('\n');

        const styleInstruction = `请严格根据提供的世界观描述，推断故事的整体风格和语言特点，并在生成社交媒体帖子时完全使用该风格的文风。例如：中国古代江湖背景使用半文半白、简洁雅致的中文；西方奇幻使用翻译腔，带有欧美小说的句式；现代都市使用流畅口语或网络用语；科幻未来可带科技感。务必让读者能通过文字感受到这个世界的气氛。`;

        return `根据以下对话历史，模拟角色${charName}和用户${userName}在今天发的社交媒体帖子（4条，混合角色和用户，JSON数组，每项包含author、content、time、likes字段）。
${styleInstruction}
对话历史：${messages || '无'}`;
    }

    async function generateContent(tabId) {
        const panel = document.getElementById(`tab-${tabId}`);
        if (!panel) return;
        
        const contentDiv = panel.querySelector('.generated-content');
        if (contentDiv) {
            contentDiv.innerHTML = '<div class="loading">⏳ 生成中，请稍候...</div>';
        }

        let prompt;
        switch (tabId) {
            case 'world': prompt = buildWorldNewsPrompt(); break;
            case 'local': prompt = buildLocalNewsPrompt(); break;
            case 'social': prompt = buildSocialMediaPrompt(); break;
            default: return;
        }

        try {
            const data = await callAI(prompt);
            renderTabContent(tabId, data);
        } catch (error) {
            if (contentDiv) {
                contentDiv.innerHTML = `<div class="error">❌ 生成失败: ${error.message}</div>`;
            }
            console.error('[悬浮球] 生成内容失败', error);
        }
    }

    function renderTabContent(tabId, data) {
        const panel = document.getElementById(`tab-${tabId}`);
        if (!panel) return;
        const contentDiv = panel.querySelector('.generated-content');
        if (!contentDiv) return;

        if (tabId === 'world') {
            contentDiv.innerHTML = data.map(item => `
                <div class="news-item">
                    <h3>${item.title}</h3>
                    <p>${item.summary}</p>
                    <span class="news-meta">—— ${item.source || '路透社'}</span>
                </div>
            `).join('');
        } else if (tabId === 'local') {
            contentDiv.innerHTML = data.map(item => `
                <div class="local-item">
                    <h4>📍 ${item.title}</h4>
                    <p>${item.content}</p>
                    <span class="local-meta">${item.location || '本地'}</span>
                </div>
            `).join('');
        } else if (tabId === 'social') {
            contentDiv.innerHTML = data.map(post => `
                <div class="social-post">
                    <strong>${post.author}</strong>
                    <p>${post.content}</p>
                    <div class="social-meta">${post.time || '刚刚'} · ❤️ ${post.likes || 0} 赞</div>
                </div>
            `).join('');
        }
    }

    // ========== 设置面板 ==========
    async function fetchModelList(baseUrl, apiKey) {
        const url = baseUrl.replace(/\/+$/, '') + '/models';
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errMsg = await response.text().catch(() => '');
            throw new Error(`请求失败 (${response.status}): ${errMsg}`);
        }

        const data = await response.json();
        if (!data.data || !Array.isArray(data.data)) {
            throw new Error('返回格式不正确，缺少 data 数组');
        }

        const modelIds = data.data.map(m => m.id).sort();
        return modelIds;
    }

    function openSettings() {
        const existing = document.getElementById('settings-panel');
        if (existing) return;

        const config = getConfig();
        const panel = document.createElement('div');
        panel.id = 'settings-panel';
        panel.className = 'settings-overlay';
        panel.innerHTML = `
            <div class="settings-box">
                <h3>⚙️ API 设置</h3>
                <label>
                    Base URL:
                    <input id="api-base" type="text" placeholder="https://api.openai.com/v1" value="${escapeHtml(config.apiBase)}">
                </label>
                <label>
                    API Key:
                    <input id="api-key" type="password" placeholder="sk-..." value="${escapeHtml(config.apiKey)}">
                </label>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button id="fetch-models-btn" class="fetch-btn">🔗 获取模型列表</button>
                    <span id="fetch-status" style="font-size:12px;"></span>
                </div>
                <label>
                    模型:
                    <select id="api-model-select" style="margin-top:4px;">
                        <option value="">请先获取模型列表...</option>
                    </select>
                    <input id="api-model-custom" type="text" placeholder="或手动输入模型 ID" value="${escapeHtml(config.model)}" style="margin-top:6px;">
                </label>
                <details class="sys-info-toggle">
                    <summary>📊 当前上下文信息</summary>
                    <div id="settings-context-info" style="font-size:12px; color:var(--text-secondary); padding:8px; background:#f4eee6; border-radius:2px; margin-top:8px;">
                        点击展开查看...
                    </div>
                </details>
                <div class="settings-actions">
                    <button id="save-settings">保存</button>
                    <button id="close-settings">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        const selectEl = document.getElementById('api-model-select');
        const customInput = document.getElementById('api-model-custom');
        const fetchBtn = document.getElementById('fetch-models-btn');
        const statusEl = document.getElementById('fetch-status');

        // 填充设置面板中的系统信息
        const updateSettingsContextInfo = () => {
            const infoDiv = document.getElementById('settings-context-info');
            if (!infoDiv) return;
            const { charName, userName } = getCharAndUser();
            const worldCount = getWorldInfoCount();
            const chatHistory = getChatHistory();
            const chatCount = chatHistory.length;
            infoDiv.innerHTML = `角色：${charName}<br>用户：${userName}<br>世界书：${worldCount} 条<br>聊天消息：${chatCount} 条`;
        };
        updateSettingsContextInfo();
        document.querySelector('.sys-info-toggle').addEventListener('toggle', updateSettingsContextInfo);

        // 获取模型列表
        fetchBtn.addEventListener('click', async () => {
            const baseUrl = document.getElementById('api-base').value.trim();
            const apiKey = document.getElementById('api-key').value.trim();

            if (!baseUrl || !apiKey) {
                statusEl.innerHTML = '<span style="color:red;">请先填写 Base URL 和 API Key</span>';
                return;
            }

            statusEl.innerHTML = '<span style="color:#c9a96e;">⏳ 正在获取模型列表...</span>';
            fetchBtn.disabled = true;

            try {
                const models = await fetchModelList(baseUrl, apiKey);
                selectEl.innerHTML = '';
                if (models.length === 0) {
                    selectEl.innerHTML = '<option value="">未找到模型，请手动输入</option>';
                } else {
                    models.forEach(modelId => {
                        const option = document.createElement('option');
                        option.value = modelId;
                        option.textContent = modelId;
                        if (modelId === config.model) option.selected = true;
                        selectEl.appendChild(option);
                    });
                    if (!selectEl.value && models.length > 0) {
                        selectEl.value = models[0];
                    }
                }
                statusEl.innerHTML = `<span style="color:green;">✔ 加载了 ${models.length} 个模型</span>`;
            } catch (error) {
                statusEl.innerHTML = `<span style="color:red;">❌ ${error.message}</span>`;
            } finally {
                fetchBtn.disabled = false;
            }
        });

        selectEl.addEventListener('change', () => {
            if (selectEl.value) {
                customInput.value = selectEl.value;
            }
        });
        customInput.addEventListener('input', () => {
            const matched = [...selectEl.options].find(opt => opt.value === customInput.value);
            if (matched) {
                selectEl.value = customInput.value;
            } else {
                selectEl.value = '';
            }
        });

        const closePanel = () => {
            window.removeEventListener('resize', onResize);
            panel.remove();
        };

        const onResize = () => {
            if (document.getElementById('settings-panel')) {
                panel.style.display = 'none';
                panel.offsetHeight;
                panel.style.display = '';
            }
        };
        window.addEventListener('resize', onResize);

        document.getElementById('close-settings').onclick = closePanel;
        panel.addEventListener('click', (e) => {
            if (e.target === panel) closePanel();
        });

        document.getElementById('save-settings').onclick = () => {
            const base = document.getElementById('api-base').value.trim();
            const key = document.getElementById('api-key').value.trim();
            const model = customInput.value.trim() || selectEl.value;
            const newConfig = {
                apiBase: base || DEFAULT_CONFIG.apiBase,
                apiKey: key,
                model: model || DEFAULT_CONFIG.model
            };
            saveConfig(newConfig);
            closePanel();
            alert('设置已保存');
        };
    }

    // 辅助：转义 HTML 防止 XSS
    function escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    // ========== 创建主弹窗 ==========
    function createModal() {
        if (modalWindow) return modalWindow;

        const modal = document.createElement('div');
        modal.id = 'my-modal-window';
        modal.className = 'modal-hidden';
        modal.style.position = 'fixed';
        modal.style.left = 'calc(50% - 200px)';
        modal.style.top = 'calc(50% - 250px)';

        const titleBar = document.createElement('div');
        titleBar.className = 'modal-titlebar';
        const titleSpan = document.createElement('span');
        titleSpan.textContent = '信息中心';
        const actionsDiv = document.createElement('div');
        
        const settingsBtn = document.createElement('button');
        settingsBtn.innerHTML = '𖥕';   // 齿轮状符号
        settingsBtn.className = 'modal-icon-btn';
        settingsBtn.title = '设置';
        settingsBtn.onclick = openSettings;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.className = 'modal-close';
        closeBtn.onclick = hideModal;
        
        actionsDiv.appendChild(settingsBtn);
        actionsDiv.appendChild(closeBtn);
        titleBar.appendChild(titleSpan);
        titleBar.appendChild(actionsDiv);

        let isModalDragging = false;
        let modalDragStartX = 0, modalDragStartY = 0;
        let modalStartLeft = 0, modalStartTop = 0;
        const onTitleStart = (e) => {
    if (e.target === closeBtn || e.target === settingsBtn) return;
    isModalDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    modalDragStartX = clientX;
    modalDragStartY = clientY;
    modalStartLeft = parseFloat(modal.style.left);
    modalStartTop = parseFloat(modal.style.top);
    if (isNaN(modalStartLeft)) modalStartLeft = (window.innerWidth - modal.offsetWidth) / 2;
    if (isNaN(modalStartTop)) modalStartTop = (window.innerHeight - modal.offsetHeight) / 2;
    modal.style.cursor = 'move';
    e.preventDefault();
};

const onTitleMove = (e) => {
    if (!isModalDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - modalDragStartX;
    const dy = clientY - modalDragStartY;
    let newLeft = modalStartLeft + dx;
    let newTop = modalStartTop + dy;
    const maxX = window.innerWidth - modal.offsetWidth;
    const maxY = window.innerHeight - modal.offsetHeight;
    newLeft = Math.min(Math.max(0, newLeft), maxX);
    newTop = Math.min(Math.max(0, newTop), maxY);
    modal.style.left = newLeft + 'px';
    modal.style.top = newTop + 'px';
    e.preventDefault();
};

const onTitleEnd = () => {
    if (isModalDragging) {
        isModalDragging = false;
        modal.style.cursor = '';
    }
};

titleBar.addEventListener('mousedown', onTitleStart);
titleBar.addEventListener('touchstart', onTitleStart, { passive: false });
window.addEventListener('mousemove', onTitleMove);
window.addEventListener('touchmove', onTitleMove, { passive: false });
window.addEventListener('mouseup', onTitleEnd);
window.addEventListener('touchend', onTitleEnd);

        const tabsHeader = document.createElement('div');
        tabsHeader.className = 'modal-tabs';
        const tabsConfig = [
            { id: 'world', title: '✦ 世界新闻', active: true },
            { id: 'local', title: '⌂ 本地新闻', active: false },
            { id: 'social', title: '@ 个人社媒', active: false }
        ];
        const tabButtons = [];
        const panels = {};

        tabsConfig.forEach((tab) => {
            const btn = document.createElement('button');
            btn.textContent = tab.title;
            btn.className = tab.active ? 'tab-btn active' : 'tab-btn';
            btn.onclick = () => {
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                Object.values(panels).forEach(p => p.classList.remove('active'));
                const targetPanel = panels[tab.id];
                if (targetPanel) targetPanel.classList.add('active');
            };
            tabsHeader.appendChild(btn);
            tabButtons.push(btn);
        });

        const contentContainer = document.createElement('div');
        contentContainer.className = 'modal-content';

        const worldPanel = document.createElement('div');
        worldPanel.id = 'tab-world';
        worldPanel.className = 'tab-panel active';
        worldPanel.innerHTML = `
            <div class="news-paper">
                <h2>✦ 世界新闻</h2>
                <div class="generated-content">
                    <p class="placeholder">点击下方按钮生成新闻</p>
                </div>
                <button class="generate-btn" data-tab="world">↻ 生成世界新闻</button>
            </div>
        `;

        const localPanel = document.createElement('div');
        localPanel.id = 'tab-local';
        localPanel.className = 'tab-panel';
        localPanel.innerHTML = `
            <div class="local-news">
                <h2>⌂ 本地新闻</h2>
                <div class="generated-content">
                    <p class="placeholder">点击下方按钮生成本地新闻</p>
                </div>
                <button class="generate-btn" data-tab="local">↻ 生成本地新闻</button>
            </div>
        `;

        const socialPanel = document.createElement('div');
        socialPanel.id = 'tab-social';
        socialPanel.className = 'tab-panel';
        socialPanel.innerHTML = `
            <div class="social-feed">
                <h2>@ 个人动态</h2>
                <div class="generated-content">
                    <p class="placeholder">点击下方按钮生成社媒动态</p>
                </div>
                <button class="generate-btn" data-tab="social">↻ 生成社媒动态</button>
            </div>
        `;

        contentContainer.appendChild(worldPanel);
        contentContainer.appendChild(localPanel);
        contentContainer.appendChild(socialPanel);

        modal.appendChild(titleBar);
        modal.appendChild(tabsHeader);
        modal.appendChild(contentContainer);
        document.body.appendChild(modal);

        modal.querySelectorAll('.generate-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.getAttribute('data-tab');
                if (tab) generateContent(tab);
            });
        });

        panels.world = worldPanel;
        panels.local = localPanel;
        panels.social = socialPanel;

        modalWindow = modal;
        return modal;
    }

    // ========== 悬浮球 ==========
    function initFloatingBall() {
    const ball = document.getElementById('my-floating-ball');
    if (!ball) return;

    let hasMoved = false;
    let isBallTouch = false;   // ← 新增标志，标识当前触摸序列是否始于悬浮球

    const onStart = (e) => {
        isDragging = true;
        hasMoved = false;
        isBallTouch = true;    // ← 标记本次触摸与悬浮球相关
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = ball.getBoundingClientRect();
        dragOffsetX = clientX - rect.left;
        dragOffsetY = clientY - rect.top;
        ball.style.cursor = 'grabbing';
        startX = clientX;
        startY = clientY;
        e.preventDefault();
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (Math.abs(dx) > clickThreshold || Math.abs(dy) > clickThreshold) {
            hasMoved = true;
        }
        let left = clientX - dragOffsetX;
        let top = clientY - dragOffsetY;
        left = Math.min(Math.max(0, left), window.innerWidth - ball.offsetWidth);
        top = Math.min(Math.max(0, top), window.innerHeight - ball.offsetHeight);
        ball.style.left = left + 'px';
        ball.style.top = top + 'px';
        e.preventDefault();
    };

    const onEnd = (e) => {
        if (!isBallTouch) return;   // ← 仅处理始于悬浮球的触摸结束
        isDragging = false;
        isBallTouch = false;        // ← 重置标志
        ball.style.cursor = 'grab';
        if (e.type === 'touchend' && !hasMoved) {
            toggleModal();
        }
    };

    ball.addEventListener('mousedown', onStart);
    ball.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);

    // 桌面端 click 备用（跳过由触摸产生的 click）
    ball.addEventListener('click', (e) => {
        if (e.pointerType === 'touch') return;
        if (hasMoved) return;
        toggleModal();
    });
}

    function constrainBallPosition(ball) {
        const maxX = window.innerWidth - ball.offsetWidth;
        const maxY = window.innerHeight - ball.offsetHeight;
        let left = parseFloat(ball.style.left) || 0;
        let top = parseFloat(ball.style.top) || 0;
        left = Math.min(Math.max(0, left), maxX);
        top = Math.min(Math.max(0, top), maxY);
        ball.style.left = left + 'px';
        ball.style.top = top + 'px';
    }

    function init() {
        console.log('[悬浮球] 插件加载...');
        const ball = document.createElement('div');
        ball.id = 'my-floating-ball';
        ball.innerHTML = '📰';
        ball.title = '信息中心';
        document.body.appendChild(ball);
        
        ball.style.left = (window.innerWidth - 60) + 'px';
        ball.style.top = (window.innerHeight - 60) + 'px';
        constrainBallPosition(ball);

        initFloatingBall();

        window.addEventListener('resize', () => {
            constrainBallPosition(ball);
        });

        console.log('[悬浮球] 加载完成');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
