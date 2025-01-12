// 全局变量声明
let db = firebase.firestore();  // 直接初始化
let timelineData = [];

// 分页相关变量
const POSTS_PER_PAGE = 10;
let currentPage = 1;
let lastVisiblePost = null;

// 语音录制相关变量
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingDuration = 0;

// 添加最大录音时长限制
const MAX_RECORDING_TIME = 30; // 30秒

// 消息提示函数
function showMessage(message, type = 'info') {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    messageEl.textContent = message;
    
    document.body.appendChild(messageEl);
    
    setTimeout(() => {
        messageEl.remove();
    }, 3000);
}

function loadPosts(lastTimestamp = null, limit = POSTS_PER_PAGE) {
    console.log('开始加载帖子...');
    
    const timelineEl = document.querySelector('.timeline');
    if (currentPage === 1) {
        timelineEl.innerHTML = '<div class="loading-indicator">加载中... 💫</div>';
    }
    
    let query = db.collection('posts')
        .orderBy('timestamp', 'desc')
        .limit(limit);  // 只获取需要显示的数据量
    
    // 如果有上次加载的最后一条数据的时间戳，从那里开始加载
    if (lastTimestamp) {
        query = query.startAfter(lastTimestamp);
    }
    
    return query.get()
        .then(snapshot => {
            if (snapshot.empty && currentPage === 1) {
                timelineEl.innerHTML = '<div class="timeline-empty">还没有任何记录哦 ✨</div>';
                return { posts: [], hasMore: false };
            }
            
            const posts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            // 追加新数据而不是替换
            if (currentPage === 1) {
                timelineData = posts;
            } else {
                timelineData = [...timelineData, ...posts];
            }
            
            renderTimeline();
            
            const hasMore = posts.length === limit;
            lastVisiblePost = snapshot.docs[snapshot.docs.length - 1];
            
            return { posts, hasMore };
        });
}

function renderTimeline() {
    console.log('开始渲染时间线');
    console.log('当前 timelineData:', timelineData);
    
    const timelineEl = document.querySelector('.timeline');
    
    if (!timelineEl) {
        console.error('找不到时间线元素');
        return;
    }
    
    if (!timelineData || !timelineData.length) {
        console.log('没有数据可渲染');
        timelineEl.innerHTML = '<div class="timeline-empty">还没有任何记录哦 ✨</div>';
        return;
    }

    // 按时间戳排序所有帖子（从新到旧）
    const sortedPosts = [...timelineData].sort((a, b) => {
        const timeA = a.timestamp instanceof firebase.firestore.Timestamp ? a.timestamp.toMillis() : a.timestamp;
        const timeB = b.timestamp instanceof firebase.firestore.Timestamp ? b.timestamp.toMillis() : b.timestamp;
        return timeB - timeA;
    });

    // 根据当前页码限制显示的数量
    const postsToShow = sortedPosts.slice(0, POSTS_PER_PAGE * currentPage);
    const hasMore = sortedPosts.length > postsToShow.length;

    console.log('排序后的帖子:', sortedPosts);
    
    // 清空现有内容
    timelineEl.innerHTML = '';
    
    // 创建新的内容容器
    const contentContainer = document.createElement('div');
    contentContainer.className = 'timeline-content';
    let currentDate = null;
    
    postsToShow.forEach((item, index) => {
        // 检查日期是否变化
        const postDate = formatDate(item.timestamp || new Date(), false);
        if (postDate !== currentDate) {
            const [year, month, day] = postDate.split('-');
            contentContainer.insertAdjacentHTML('beforeend', `
                <div class="date-divider">
                    <span>
                        <span class="year">${year}年</span>
                        <span class="month">${month}月</span>
                        <span class="day">${day}日</span>
                    </span>
                </div>
            `);
            currentDate = postDate;
        }
        
        // 为新加载的内容添加动画类
        const isNewItem = index >= (currentPage - 1) * POSTS_PER_PAGE;
        const animationClass = isNewItem ? 'new-item' : '';
        
        const userHtml = `<div class="timeline-user">${item.user}</div>`;
        const dateHtml = `<div class="timeline-date">${formatDate(item.timestamp || new Date(), true)}</div>`;
        
        contentContainer.insertAdjacentHTML('beforeend', `
            <div class="timeline-item ${animationClass}" data-user="${item.user}">
                <div class="timeline-header">
                    ${item.user === '晁森豪' ? `
                        <div class="timeline-user">
                            ${item.user === '晁森豪' ? '🤴 ' : '👸 '}
                            ${item.user} 
                            ${item.user === '晁森豪' ? ' 💫' : ' ✨'}
                        </div>
                        <div class="timeline-date">
                            🕐 ${formatDate(item.timestamp || new Date(), true)} ⌛
                        </div>
                    ` : `
                        <div class="timeline-date">
                            🕐 ${formatDate(item.timestamp || new Date(), true)} ⌛
                        </div>
                        <div class="timeline-user">
                            ${item.user === '晁森豪' ? '🤴 ' : '👸 '}
                            ${item.user} 
                            ${item.user === '晁森豪' ? ' 💫' : ' ✨'}
                        </div>
                    `}
                </div>
                ${item.mood ? `
                    <div class="timeline-mood" data-mood="${item.mood}">
                        ${getMoodEmoji(item.mood)}
                    </div>
                ` : ''}
                <div class="timeline-text">
                    ${item.content.split('\n').map(line => `<p>${line}</p>`).join('')}
                </div>
                ${item.images && item.images.length ? `
                    <div class="timeline-media">
                        ${item.images.map(img => `
                            <img src="${img}" 
                                 alt="照片" 
                                 onclick="showImagePreview('${img}')"
                                 loading="lazy"
                                 style="cursor: pointer;">
                        `).join('')}
                    </div>
                ` : ''}
                ${item.voice ? `
                    <div class="voice-message">
                        <audio src="${item.voice}" controls></audio>
                    </div>
                ` : ''}
                <div class="timeline-footer">
                    <div class="reply-section">
                        <div class="replies" id="replies-${item.id}">
                            <!-- 回复内容将在这里显示 -->
                        </div>
                        <button class="reply-toggle-btn" onclick="toggleReplyForm('${item.id}')">
                            <i class="fas fa-reply"></i> 回复
                        </button>
                        <div class="reply-form" id="reply-form-${item.id}" style="display: none;">
                            <textarea class="reply-input" placeholder="写下你的回复..."></textarea>
                            <button class="reply-submit-btn" onclick="submitReply('${item.id}')">发送</button>
                        </div>
                    </div>
                    <button class="delete-btn" onclick="deletePost('${item.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `);
        loadReplies(item.id);
    });
    
    // 添加内容到页面
    timelineEl.appendChild(contentContainer);
    
    // 如果还有更多数据可以加载，显示加载更多按钮
    if (hasMore) {
        addLoadMoreButton();
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('页面加载完成，初始化...');
    
    // 初始化数据库连接
    initializeDatabase();
    
    // 设置实时更新之前先加载数据
    loadPosts().then(() => {
        console.log('初始数据加载完成');
        // 设置实时更新
        setupRealtimeUpdates();
    }).catch(error => {
        console.error('初始数据加载失败:', error);
    });
    
    // 监听网络状态
    window.addEventListener('online', () => {
        console.log('网络已连接');
        showMessage('网络已连接 🌐', 'success');
        loadPosts();
    });

    window.addEventListener('offline', () => {
        console.log('网络已断开');
        showMessage('网络已断开，使用离线数据 ⚠️', 'error');
    });
    
    // 添加图片上传监听器
    document.getElementById('image').addEventListener('change', handleImageUpload);
    
    // 添加表单提交监听器
    document.getElementById('post-form').addEventListener('submit', (e) => {
        e.preventDefault();
        submitPost();
    });
    
    setupFilters();
    initVoiceRecording();
});

// 修改 initializeDatabase 函数
function initializeDatabase() {
    console.log('正在初始化数据库连接...');
    try {
        console.log('数据库连接初始化成功');
        return true;
    } catch (error) {
        console.error('数据库连接初始化失败:', error);
        showMessage('数据库连接失败 ⚠️', 'error');
        return false;
    }
}

// 修改 setupRealtimeUpdates 函数
function setupRealtimeUpdates() {
    console.log('设置实时更新监听...');
    db.collection('posts')
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
            console.log('收到实时更新:', snapshot.docChanges().length, '条变更');
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const newPost = {
                        id: change.doc.id,
                        ...change.doc.data()
                    };
                    console.log('新增帖子:', newPost);
                    // 检查是否是新发布的帖子（最近5秒内）
                    const isNewPost = newPost.timestamp && 
                        (Date.now() - newPost.timestamp.toMillis() < 5000);
                    
                    if (!timelineData.some(post => post.id === newPost.id)) {
                        if (isNewPost) {
                            timelineData.unshift(newPost);
                        } else {
                            timelineData.push(newPost);
                        }
                        renderTimeline();
                    }
                }
                // ... 其他代码保持不变
            });
        }, (error) => {
            console.error('实时更新出错:', error);
            showMessage('实时更新连接失败，请刷新页面', 'error');
        });
}

// 处理图片上传
function handleImageUpload(event) {
    const files = event.target.files;
    const previewContainer = document.getElementById('preview-container');
    previewContainer.innerHTML = '';
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.createElement('img');
            img.src = e.target.result;
            previewContainer.appendChild(img);
        }
        reader.readAsDataURL(file);
    });
}

// 格式化日期
function formatDate(timestamp, includeTime = false) {
    if (!timestamp) return '未知时间';
    
    const date = timestamp instanceof firebase.firestore.Timestamp 
        ? timestamp.toDate() 
        : new Date(timestamp);
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return includeTime 
        ? `${year}-${month}-${day} ${hours}:${minutes}`
        : `${year}-${month}-${day}`;
}

// 获取心情表情
function getMoodEmoji(mood) {
    const moods = {
        'happy': '😊 开心',
        'sad': '😢 难过',
        'excited': '🥳 激动',
        'angry': '😠 生气',
        'love': '❤️ 爱你'
    };
    return moods[mood] || mood;
}

// 提交帖子
async function submitPost() {
    const content = document.getElementById('content').value;
    const mood = document.getElementById('mood').value;
    const user = document.getElementById('user').value;
    const imageFiles = document.getElementById('image').files;
    const loadingEl = document.getElementById('loading');
    const voicePreview = document.getElementById('voicePreview');
    
    if (!content.trim()) {
        showMessage('请输入内容 ✍️', 'warning');
        return;
    }
    
    loadingEl.style.display = 'block';
    
    try {
        const post = {
            content: content.trim(),
            mood,
            user,
            timestamp: firebase.firestore.Timestamp.fromDate(new Date()),
            date: new Date().toISOString().split('T')[0]
        };

        // 处理图片上传
        if (imageFiles.length > 0) {
            const images = [];
            for (const file of imageFiles) {
                const imageUrl = await uploadImage(file);
                images.push(imageUrl);
            }
            post.images = images;
        }
        
        // 处理语音
        if (voicePreview && voicePreview.src && voicePreview.src.startsWith('data:audio')) {
            post.voice = voicePreview.src; // 直接存储Base64编码的音频
        }

        // 保存帖子到数据库
        await db.collection('posts').add(post);
        
        // 清空表单
        document.getElementById('post-form').reset();
        document.getElementById('preview-container').innerHTML = '';
        if (voicePreview) {
            voicePreview.src = '';
            voicePreview.style.display = 'none';
        }
        document.querySelector('.voice-timer').style.display = 'none';
        document.getElementById('recordVoiceBtn').innerHTML = '<i class="fas fa-microphone"></i> 开始录音';
        
        showMessage('发布成功 🎉', 'success');
        
    } catch (error) {
        console.error('发布失败:', error);
        showMessage('发布失败，请重试 😢', 'error');
    } finally {
        loadingEl.style.display = 'none';
    }
}

// 删除帖子
async function deletePost(postId) {
    if (!confirm('确定要删除这条记录吗？')) return;
    
    try {
        await db.collection('posts').doc(postId).delete();
        showMessage('删除成功 🗑️', 'success');
        
        // 更新本地数据
        timelineData = timelineData.filter(post => post.id !== postId);
        renderTimeline();
        
    } catch (error) {
        console.error('删除失败:', error);
        showMessage('删除失败 😢', 'error');
    }
}

// 设置筛选功能
function setupFilters() {
    const dateFilter = document.getElementById('dateFilter');
    const moodFilter = document.getElementById('moodFilter');
    const userFilter = document.getElementById('userFilter');
    
    // 保存原始数据
    let originalData = [];
    
    // 应用筛选
    function applyFilters() {
        let filteredData = [...originalData];
        
        // 日期筛选
        if (dateFilter.value) {
            filteredData = filteredData.filter(post => 
                formatDate(post.timestamp) === dateFilter.value
            );
        }
        
        // 心情筛选
        if (moodFilter.value) {
            filteredData = filteredData.filter(post => post.mood === moodFilter.value);
        }
        
        // 用户筛选
        if (userFilter.value) {
            filteredData = filteredData.filter(post => post.user === userFilter.value);
        }
        
        // 更新显示
        const tempTimelineData = timelineData;
        timelineData = filteredData;
        renderTimeline();
        timelineData = tempTimelineData;
    }
    
    // 添加筛选器的事件监听
    dateFilter.addEventListener('change', applyFilters);
    moodFilter.addEventListener('change', applyFilters);
    userFilter.addEventListener('change', applyFilters);
    
    // 在加载数据时更新原始数据
    loadPosts().then(() => {
        originalData = [...timelineData];
    });
}

// 修改加载更多按钮
function addLoadMoreButton() {
    const button = document.createElement('button');
    button.className = 'load-more-btn';
    button.innerHTML = '加载更多 📜';
    
    button.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        button.disabled = true;
        button.innerHTML = '正在加载... 💫';
        
        try {
            currentPage++;
            const { hasMore } = await loadPosts(lastVisiblePost, POSTS_PER_PAGE);
            
            if (!hasMore) {
                button.innerHTML = '没有更多内容了 🌟';
                button.disabled = true;
                button.style.opacity = '0.5';
                setTimeout(() => button.remove(), 300);
            } else {
                button.innerHTML = '加载更多 📜';
                button.disabled = false;
            }
        } catch (error) {
            console.error('加载失败:', error);
            button.innerHTML = '加载失败，点击重试 ⚠️';
            button.disabled = false;
            currentPage--;
        }
        
        return false;
    };
    
    document.querySelector('.timeline').appendChild(button);
}

function showImagePreview(imgUrl) {
    const modal = document.getElementById('imagePreviewModal');
    const previewImg = document.getElementById('previewImage');
    if (modal && previewImg) {
        modal.style.display = 'block';
        previewImg.src = imgUrl;
        
        // 添加关闭功能
        const closeBtn = modal.querySelector('.close-modal');
        closeBtn.onclick = () => modal.style.display = 'none';
        
        // 点击模态框背景也可以关闭
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }
}

// 修改切换回复表单的函数
function toggleReplyForm(postId) {
    const form = document.getElementById(`reply-form-${postId}`);
    if (form) {
        const isHidden = form.style.display === 'none';
        form.style.display = isHidden ? 'block' : 'none';
        
        // 如果是显示表单，自动聚焦到输入框
        if (isHidden) {
            const input = form.querySelector('.reply-input');
            if (input) {
                input.focus();
            }
        }
    }
}

// 提交回复
async function submitReply(postId) {
    const replyInput = document.querySelector(`#reply-form-${postId} .reply-input`);
    const content = replyInput.value.trim();
    
    if (!content) {
        showMessage('请输入回复内容 ✍️', 'warning');
        return;
    }
    
    try {
        const reply = {
            content,
            user: document.getElementById('user').value,
            timestamp: firebase.firestore.Timestamp.fromDate(new Date()),
            postId
        };
        
        await db.collection('replies').add(reply);
        replyInput.value = '';
        document.getElementById(`reply-form-${postId}`).style.display = 'none';
        showMessage('回复成功 🎉', 'success');
        
        // 刷新并显示回复
        await loadReplies(postId);
        document.getElementById(`replies-${postId}`).style.display = 'block';
        
    } catch (error) {
        console.error('回复失败:', error);
        showMessage('回复失败 😢', 'error');
    }
}

// 加载回复
async function loadReplies(postId) {
    const repliesDiv = document.getElementById(`replies-${postId}`);
    
    if (!repliesDiv) {
        console.warn(`等待回复容器: replies-${postId}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return loadReplies(postId);
    }
    
    try {
        const snapshot = await db.collection('replies')
            .where('postId', '==', postId)
            .orderBy('timestamp', 'desc')
            .get();
        
        let repliesHtml = '';
        
        if (!snapshot.empty) {
            repliesHtml = snapshot.docs.map(doc => {
                const reply = doc.data();
                const replyId = doc.id;
                const replyUserHtml = `<span class="reply-user">${reply.user}</span>`;
                const replyTimeHtml = `<span class="reply-time">${formatDate(reply.timestamp, true)}</span>`;
                return `
                    <div class="reply-item" data-user="${reply.user}" data-reply-id="${replyId}">
                        <div class="reply-header">
                            ${replyUserHtml}
                            ${replyTimeHtml}
                        </div>
                        <div class="reply-content">
                            ${reply.content}
                        </div>
                        <div class="reply-actions">
                            <button class="nested-reply-btn" onclick="toggleNestedReplyForm('${replyId}', '${postId}')">
                                <i class="fas fa-reply"></i> 回复
                            </button>
                            <button class="reply-delete-btn" onclick="deleteReply('${replyId}', '${postId}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                        <div class="nested-reply-form-wrapper" id="nested-reply-form-${replyId}" style="display: none;">
                            <div class="nested-reply-form">
                                <textarea class="nested-reply-input" id="nested-reply-input-${replyId}" placeholder="回复这条评论..."></textarea>
                                <div class="nested-reply-actions">
                                    <button class="nested-reply-submit" onclick="submitNestedReply('${replyId}', '${postId}')">
                                        <i class="fas fa-paper-plane"></i> 发送
                                    </button>
                                    <button class="nested-reply-cancel" onclick="toggleNestedReplyForm('${replyId}', '${postId}')">
                                        <i class="fas fa-times"></i> 取消
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="nested-replies" id="nested-replies-${replyId}"></div>
                    </div>
                `;
            }).join('');
        }
        
        repliesDiv.innerHTML = repliesHtml || '';
        
        // 加载每条回复的嵌套回复
        if (!snapshot.empty) {
            for (const doc of snapshot.docs) {
                await loadNestedReplies(doc.id);
            }
        }
        
    } catch (error) {
        console.error('加载回复失败:', error);
        repliesDiv.innerHTML = '<div class="reply-error">加载回复失败，请稍后重试</div>';
    }
}

// 修改切换嵌套回复表单的函数
function toggleNestedReplyForm(replyId, postId) {
    console.log('切换嵌套回复表单:', replyId, postId);
    
    // 先关闭所有其他打开的回复表单
    document.querySelectorAll('.nested-reply-form-wrapper').forEach(form => {
        if (form.id !== `nested-reply-form-${replyId}`) {
            form.style.display = 'none';
        }
    });
    
    const formWrapper = document.getElementById(`nested-reply-form-${replyId}`);
    if (!formWrapper) {
        console.error('找不到嵌套回复表单容器:', replyId);
        return;
    }
    
    const isHidden = formWrapper.style.display === 'none';
    formWrapper.style.display = isHidden ? 'block' : 'none';
    
    if (isHidden) {
        const input = document.getElementById(`nested-reply-input-${replyId}`);
        if (input) {
            input.focus();
            // 存储当前回复的上下文
            input.dataset.replyId = replyId;
            input.dataset.postId = postId;
        }
    }
}

// 修改提交嵌套回复的函数
async function submitNestedReply(parentReplyId, postId) {
    const input = document.getElementById(`nested-reply-input-${parentReplyId}`);
    if (!input) {
        console.error('找不到输入框');
        return;
    }
    
    const content = input.value.trim();
    if (!content) {
        showMessage('请输入回复内容 ✍️', 'warning');
        return;
    }
    
    try {
        const nestedReply = {
            content,
            user: document.getElementById('user').value,
            timestamp: firebase.firestore.Timestamp.fromDate(new Date()),
            parentReplyId,
            postId
        };
        
        await db.collection('nested_replies').add(nestedReply);
        input.value = '';
        
        // 隐藏表单
        const formWrapper = document.getElementById(`nested-reply-form-${parentReplyId}`);
        if (formWrapper) {
            formWrapper.style.display = 'none';
        }
        
        showMessage('回复成功 🎉', 'success');
        
        // 刷新嵌套回复显示
        await loadNestedReplies(parentReplyId);
        
    } catch (error) {
        console.error('回复失败:', error);
        showMessage('回复失败，请重试 😢', 'error');
    }
}

// 修改加载嵌套回复的函数
async function loadNestedReplies(parentReplyId) {
    const nestedRepliesDiv = document.getElementById(`nested-replies-${parentReplyId}`);
    
    if (!nestedRepliesDiv) {
        console.warn(`等待嵌套回复容器: nested-replies-${parentReplyId}`);
        return;
    }
    
    try {
        let snapshot;
        try {
            // 尝试使用排序的查询
            snapshot = await db.collection('nested_replies')
                .where('parentReplyId', '==', parentReplyId)
                .orderBy('timestamp', 'asc')
                .get();
        } catch (error) {
            if (error.code === 'failed-precondition') {
                // 如果索引不存在，使用不带排序的查询
                console.warn('需要创建索引，暂时使用未排序的查询');
                console.log('索引创建链接:', error.message.split('You can create it here: ')[1]);
                
                snapshot = await db.collection('nested_replies')
                    .where('parentReplyId', '==', parentReplyId)
                    .get();
            } else {
                throw error;
            }
        }
        
        if (!snapshot.empty) {
            let replies = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            // 如果使用了未排序的查询，手动排序
            if (!snapshot.query?._query?.orderBy) {
                replies.sort((a, b) => {
                    const timeA = a.timestamp?.toMillis() || 0;
                    const timeB = b.timestamp?.toMillis() || 0;
                    return timeA - timeB;
                });
            }
            
            const nestedRepliesHtml = replies.map(reply => {
                const replyUserHtml = `<span class="reply-user">${reply.user}</span>`;
                const replyTimeHtml = `<span class="reply-time">${formatDate(reply.timestamp, true)}</span>`;
                return `
                    <div class="nested-reply" data-user="${reply.user}">
                        <div class="reply-header">
                            ${replyUserHtml}
                            ${replyTimeHtml}
                        </div>
                        <div class="reply-content">
                            ${reply.content}
                        </div>
                        <div class="reply-actions">
                            <button class="nested-reply-btn" onclick="toggleNestedReplyForm('${reply.id}', '${reply.postId}')">
                                <i class="fas fa-reply"></i> 回复
                            </button>
                            <button class="reply-delete-btn" onclick="deleteNestedReply('${reply.id}', '${reply.parentReplyId}', '${reply.postId}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                        <div class="nested-reply-form-wrapper" id="nested-reply-form-${reply.id}" style="display: none;">
                            <div class="nested-reply-form">
                                <textarea class="nested-reply-input" id="nested-reply-input-${reply.id}" placeholder="回复这条评论..."></textarea>
                                <div class="nested-reply-actions">
                                    <button class="nested-reply-submit" onclick="submitNestedReply('${reply.id}', '${reply.postId}')">
                                        <i class="fas fa-paper-plane"></i> 发送
                                    </button>
                                    <button class="nested-reply-cancel" onclick="toggleNestedReplyForm('${reply.id}', '${reply.postId}')">
                                        <i class="fas fa-times"></i> 取消
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="nested-replies" id="nested-replies-${reply.id}"></div>
                    </div>
                `;
            }).join('');
            
            nestedRepliesDiv.innerHTML = nestedRepliesHtml;
            
            // 加载每条嵌套回复的子回复
            for (const reply of replies) {
                await loadNestedReplies(reply.id);
            }
        } else {
            nestedRepliesDiv.innerHTML = '';
        }
        
    } catch (error) {
        console.error('加载嵌套回复失败:', error);
        nestedRepliesDiv.innerHTML = '<div class="reply-error">加载嵌套回复失败</div>';
    }
}

// 添加删除回复的函数
async function deleteReply(replyId, postId) {
    if (!confirm('确定要删除这条回复吗？')) return;
    
    try {
        // 删除回复
        await db.collection('replies').doc(replyId).delete();
        
        // 删除该回复下的所有嵌套回复
        const nestedRepliesSnapshot = await db.collection('nested_replies')
            .where('parentReplyId', '==', replyId)
            .get();
            
        const batch = db.batch();
        nestedRepliesSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        
        showMessage('删除成功 🗑️', 'success');
        
        // 重新加载回复
        await loadReplies(postId);
        
    } catch (error) {
        console.error('删除回复失败:', error);
        showMessage('删除失败 😢', 'error');
    }
}

// 添加删除嵌套回复的函数
async function deleteNestedReply(nestedReplyId, parentReplyId, postId) {
    if (!confirm('确定要删除这条回复吗？')) return;
    
    try {
        await db.collection('nested_replies').doc(nestedReplyId).delete();
        showMessage('删除成功 🗑️', 'success');
        
        // 重新加载嵌套回复
        await loadNestedReplies(parentReplyId);
        
    } catch (error) {
        console.error('删除嵌套回复失败:', error);
        showMessage('删除失败 😢', 'error');
    }
}

// 初始化语音录制功能
async function initVoiceRecording() {
    const recordBtn = document.getElementById('recordVoiceBtn');
    const timer = document.querySelector('.voice-timer');
    const voicePreview = document.getElementById('voicePreview');

    recordBtn.addEventListener('click', async () => {
        if (!mediaRecorder) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                // 检测设备类型并设置适当的音频格式
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                const mimeType = isIOS ? 'audio/mp4' : 'audio/webm';
                
                mediaRecorder = new MediaRecorder(stream, {
                    mimeType: isIOS ? 'audio/mp4' : 'audio/webm;codecs=opus',
                    audioBitsPerSecond: 128000
                });
                
                audioChunks = [];

                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { 
                        type: isIOS ? 'audio/mp4' : 'audio/webm;codecs=opus'
                    });
                    
                    // 使用 URL.createObjectURL 而不是 Base64
                    const audioUrl = URL.createObjectURL(audioBlob);
                    voicePreview.src = audioUrl;
                    voicePreview.style.display = 'block';
                    
                    // 确保音频加载完成
                    voicePreview.load();
                    
                    // 添加错误处理
                    voicePreview.onerror = (e) => {
                        console.error('音频加载失败:', e);
                        showMessage('音频加载失败，请重试 🎤', 'error');
                    };
                };

                mediaRecorder.start();
                recordBtn.innerHTML = '<i class="fas fa-stop"></i> 停止录音';
                recordBtn.classList.add('recording');
                timer.style.display = 'block';
                startTimer();

            } catch (error) {
                console.error('录音失败:', error);
                showMessage('无法访问麦克风 🎤', 'error');
            }
        } else {
            // 停止录音
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            mediaRecorder = null;
            recordBtn.innerHTML = '<i class="fas fa-microphone"></i> 开始录音';
            recordBtn.classList.remove('recording');
            stopTimer();
        }
    });
}

// 计时器函数
function startTimer() {
    recordingDuration = 0;
    const timer = document.querySelector('.voice-timer');
    recordingTimer = setInterval(() => {
        recordingDuration++;
        const minutes = Math.floor(recordingDuration / 60);
        const seconds = recordingDuration % 60;
        timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // 到达最大时长时自动停止
        if (recordingDuration >= MAX_RECORDING_TIME) {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                mediaRecorder.stream.getTracks().forEach(track => track.stop());
                mediaRecorder = null;
                document.getElementById('recordVoiceBtn').innerHTML = '<i class="fas fa-microphone"></i> 开始录音';
                document.getElementById('recordVoiceBtn').classList.remove('recording');
                stopTimer();
                showMessage('已达到最大录音时长 ⏱️', 'warning');
            }
        }
    }, 1000);
}

function stopTimer() {
    clearInterval(recordingTimer);
    document.querySelector('.voice-timer').style.display = 'none';
}

// 上传语音文件
async function uploadVoice(voiceBlob) {
    try {
        console.log('开始上传语音文件...');
        const storageRef = firebase.storage().ref();
        const voiceRef = storageRef.child(`voices/${Date.now()}.wav`);
        
        // 显示上传进度
        const uploadTask = voiceRef.put(voiceBlob);
        
        // 监听上传进度
        uploadTask.on('state_changed', 
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                console.log('上传进度: ' + progress + '%');
            },
            (error) => {
                console.error('语音上传失败:', error);
                throw error;
            }
        );

        // 等待上传完成
        await uploadTask;
        console.log('语音文件上传成功');
        
        // 获取下载URL
        const downloadURL = await voiceRef.getDownloadURL();
        console.log('获取到语音文件URL');
        return downloadURL;
        
    } catch (error) {
        console.error('语音上传过程出错:', error);
        throw error;
    }
}
