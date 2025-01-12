// 全局变量声明
let db = firebase.firestore();  // 直接初始化
let timelineData = [];
let currentUser = null; // 当前用户

// 分页相关变量
const POSTS_PER_PAGE = 5;
let currentPage = 1;
let lastVisiblePost = null;

// 语音录制相关变量
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingDuration = 0;

// 添加最大录音时长限制
const MAX_RECORDING_TIME = 30; // 30秒

// 添加缓存系统
const postCache = new Map();
const imageCache = new Map();

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

// 添加重试机制的函数
function withRetry(operation, maxRetries = 3, delay = 1000) {
    return new Promise(async (resolve, reject) => {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const result = await operation();
                return resolve(result);
            } catch (error) {
                if (i === maxRetries - 1) {
                    reject(error);
                } else {
                    console.log(`重试操作 (${i + 1}/${maxRetries})...`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
    });
}

// 修改加载帖子函数
async function loadPosts(lastTimestamp = null) {
    const timelineEl = document.querySelector('.timeline');
    
    // 移除已有的加载提示
    const existingIndicators = timelineEl.querySelectorAll('.loading-indicator');
    existingIndicators.forEach(indicator => indicator.remove());
    
    // 记录当前滚动位置
    const scrollPosition = window.scrollY;
    
    // 创建加载提示
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.textContent = '正在加载内容... 📃';
    loadingIndicator.style.height = '50px';
    timelineEl.appendChild(loadingIndicator);
    
    try {
        let query = db.collection('posts')
            .orderBy('timestamp', 'desc')
            .limit(5);
        
        if (lastTimestamp) {
            query = query.startAfter(lastTimestamp);
        }
        
        const snapshot = await query.get();
        
        if (snapshot.empty) {
            loadingIndicator.textContent = lastTimestamp ? '已经到底啦 🎈' : '还没有任何记录哦 ✨';
            setTimeout(() => {
                loadingIndicator.style.opacity = '0';
                setTimeout(() => loadingIndicator.remove(), 300);
            }, 2000);
            return { posts: [], hasMore: false };
        }
        
        const posts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        lastVisiblePost = snapshot.docs[snapshot.docs.length - 1];
        
        // 更新数据
        if (!lastTimestamp) {
            timelineData = posts;
        } else {
            timelineData = [...timelineData, ...posts];
        }
        
        // 使用原有的渲染函数，但在 requestAnimationFrame 中执行
        requestAnimationFrame(() => {
            renderTimeline(); // 使用原有的渲染函数
            
            // 如果还有更多内容，添加提示
            if (posts.length === 5) {
                const moreIndicator = document.createElement('div');
                moreIndicator.className = 'loading-indicator';
                moreIndicator.textContent = '上滑加载更多 ⬆️';
                moreIndicator.style.height = '50px';
                timelineEl.appendChild(moreIndicator);
            }
            
            // 恢复滚动位置
            window.scrollTo(0, scrollPosition);
        });
        
        return {
            posts,
            hasMore: posts.length === 5
        };
        
    } catch (error) {
        console.error('加载帖子失败:', error);
        loadingIndicator.textContent = '加载失败，请重试 😢';
        setTimeout(() => {
            loadingIndicator.style.opacity = '0';
            setTimeout(() => loadingIndicator.remove(), 300);
        }, 2000);
        return { posts: [], hasMore: false };
    }
}

// 预加载下一页
function preloadNextPage(lastTimestamp) {
    const nextQuery = db.collection('posts')
        .orderBy('timestamp', 'desc')
        .startAfter(lastTimestamp)
        .limit(POSTS_PER_PAGE);
        
    nextQuery.get().then(snapshot => {
        const posts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // 缓存下一页数据
        const cacheKey = `posts_${lastTimestamp}_${POSTS_PER_PAGE}`;
        postCache.set(cacheKey, {
            posts,
            hasMore: posts.length === POSTS_PER_PAGE
        });
    });
}

function renderTimeline() {
    const timelineEl = document.querySelector('.timeline');
    if (!timelineData || !timelineData.length) {
        timelineEl.innerHTML = '<div class="timeline-empty">还没有任何记录哦 ✨</div>';
        return;
    }

    // 按时间倒序排序
    timelineData.sort((a, b) => {
        const timeA = a.timestamp instanceof firebase.firestore.Timestamp ? a.timestamp.toDate() : new Date(a.timestamp);
        const timeB = b.timestamp instanceof firebase.firestore.Timestamp ? b.timestamp.toDate() : new Date(b.timestamp);
        return timeB - timeA; // 倒序排列
    });

    // 按日期分组
    let currentDate = null;
    const html = timelineData.map(post => {
        const postDate = post.timestamp instanceof firebase.firestore.Timestamp 
            ? post.timestamp.toDate() 
            : new Date(post.timestamp);
        
        const dateStr = formatDate(postDate, false);
        let dateDivider = '';
        
        if (dateStr !== currentDate) {
            currentDate = dateStr;
            const year = postDate.getFullYear();
            const month = String(postDate.getMonth() + 1).padStart(2, '0');
            const day = String(postDate.getDate()).padStart(2, '0');
            
            dateDivider = `
                <div class="date-divider">
                    <span>
                        <span class="year">${year}</span>年
                        <span class="month">${month}</span>月
                        <span class="day">${day}</span>日
                    </span>
                </div>
            `;
        }

        // 获取表情
        const moodEmoji = getMoodEmoji(post.mood);
        const userEmoji = post.user === '晁森豪' ? '🤴' : '👸';
        
        // 处理图片内容
        const imageContent = post.images ? renderImages(post.images) : '';
        
        // 处理语音内容
        const voiceContent = post.voice ? `
            <div class="voice-preview-container">
                <audio controls src="${post.voice}"></audio>
            </div>
        ` : '';

        const isCurrentUser = post.user === currentUser;
        const deleteButton = isCurrentUser ? `
            <span class="separator"></span>
            <button class="delete-post-btn" onclick="deletePost('${post.id}')">
                <i class="fas fa-trash-alt"></i>
            </button>
        ` : '';

        const postHtml = `
            <div class="timeline-item" data-user="${post.user}">
                <div class="timeline-header">
                    <div class="timeline-user" style="font-size: calc(var(--base-font-size) * 0.64) !important;">
                        <span>${userEmoji}</span>
                        <span>${post.user}</span>
                    </div>
                    <div class="timeline-date" style="font-size: calc(var(--base-font-size) * 0.64) !important;">
                        <i class="far fa-clock"></i>
                        <span>${formatTime(post.timestamp)}</span>
                        ${deleteButton}
                    </div>
                </div>
                <div class="timeline-content">
                    <div class="timeline-mood" ${post.mood ? `data-mood="${post.mood}"` : ''}>
                        ${post.mood ? `<span>${moodEmoji}</span><span>${post.mood}</span>` : ''}
                    </div>
                    <div class="timeline-text" style="font-size: calc(var(--base-font-size) * 0.64) !important;">
                        ${post.content}
                    </div>
                    ${imageContent}
                    ${voiceContent}
                </div>
                <div class="timeline-footer">
                    <div class="reply-section">
                        <button class="reply-toggle-btn" onclick="toggleReplyForm('${post.id}')">
                            <i class="fas fa-comment"></i> 回复
                        </button>
                        <div id="replyForm-${post.id}" class="reply-form" style="display: none;">
                            <textarea class="reply-input" placeholder="写下你的回复..."></textarea>
                            <button class="reply-submit-btn" onclick="submitReply('${post.id}')">
                                <i class="fas fa-paper-plane"></i> 发送
                            </button>
                        </div>
                        <div id="replies-${post.id}" class="replies"></div>
                    </div>
                </div>
            </div>
        `;

        return dateDivider + postHtml;
    }).join('');

    timelineEl.innerHTML = html;
    
    // 加载每个帖子的回复
    timelineData.forEach(post => {
        loadReplies(post.id);
    });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 显示选择弹窗
    const modalEl = document.getElementById('userSelectModal');
    const containerEl = document.querySelector('.container');
    
    if (!currentUser) {
        modalEl.style.display = 'flex';
        containerEl.style.display = 'none';
    } else {
        modalEl.style.display = 'none';
        containerEl.style.display = 'block';
        initializeApp();
    }
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
    const query = db.collection('posts')
        .orderBy('timestamp', 'desc')
        .limit(5); // 只监听最新的5条
        
    query.onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            const post = {
                id: change.doc.id,
                ...change.doc.data()
            };
            
            if (change.type === 'added') {
                if (!timelineData.some(p => p.id === post.id)) {
                    timelineData.unshift(post);
                    requestAnimationFrame(() => {
                        renderTimeline(true);
                    });
                }
            }
            
            if (change.type === 'modified') {
                console.log('修改帖子:', post);
                const index = timelineData.findIndex(p => p.id === post.id);
                if (index !== -1) {
                    timelineData[index] = post;
                    requestAnimationFrame(() => {
                        renderTimeline(true);
                    });
                }
            }
            
            if (change.type === 'removed') {
                console.log('删除帖子:', post);
                const index = timelineData.findIndex(p => p.id === post.id);
                if (index !== -1) {
                    timelineData.splice(index, 1);
                    requestAnimationFrame(() => {
                        renderTimeline(true);
                    });
                }
            }
        });
    });
    
    // 添加网络状态监听
    window.addEventListener('online', () => {
        showMessage('网络已恢复，重新连接... 🌐', 'success');
        setupRealtimeUpdates();
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
    if (!currentUser) {
        showMessage('请先选择用户身份 😅', 'error');
        return;
    }

    const content = document.getElementById('content').value.trim();
    const mood = document.getElementById('mood').value;
    const imageFiles = document.getElementById('image').files;
    const voiceBlob = audioChunks.length ? new Blob(audioChunks, { type: 'audio/wav' }) : null;

    if (!content && !imageFiles.length && !voiceBlob) {
        showMessage('请输入内容或上传图片/语音 📝', 'warning');
        return;
    }

    try {
        document.getElementById('loading').style.display = 'block';
        showMessage('正在处理内容...', 'info');

        // 处理图片，添加进度提示
        let images = [];
        if (imageFiles.length > 0) {
            showMessage(`正在处理图片 (0/${imageFiles.length})...`, 'info');
            for (let i = 0; i < imageFiles.length; i++) {
                const compressedImage = await compressImage(imageFiles[i]);
                images.push(compressedImage);
                showMessage(`正在处理图片 (${i + 1}/${imageFiles.length})...`, 'info');
            }
        }

        // 处理语音
        let voiceData = null;
        if (audioChunks && audioChunks.length > 0) {
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const audioBlob = new Blob(audioChunks, { 
                type: isIOS ? 'audio/mp4' : 'audio/webm'
            });
            
            try {
                voiceData = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(audioBlob);
                });
            } catch (error) {
                console.error('语音处理失败:', error);
                showMessage('语音处理失败，请重试 🎤', 'error');
                return;
            }
        }

        // 创建主帖子
        const post = {
            content,
            user: currentUser,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            mood: mood || null,
            images: images.length > 0 ? images : null,
            voice: voiceData // 只存储引用信息
        };

        await db.collection('posts').add(post);
        
        // 清空表单
        document.getElementById('post-form').reset();
        document.getElementById('preview-container').innerHTML = '';
        audioChunks = [];
        if (document.getElementById('voicePreview')) {
            document.getElementById('voicePreview').style.display = 'none';
        }
        
        showMessage('发布成功 🎉', 'success');
    } catch (error) {
        console.error('发布失败:', error);
        showMessage('发布失败，请重试 😢', 'error');
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

// 删除帖子
function deletePost(postId) {
    // 先获取帖子数据进行权限验证
    db.collection('posts').doc(postId).get().then(doc => {
        if (doc.exists && doc.data().user === currentUser) {
            if (confirm('确定要删除这条记录吗？')) {
                db.collection('posts').doc(postId).delete()
                    .then(() => {
                        // 从数组中移除已删除的帖子
                        timelineData = timelineData.filter(post => post.id !== postId);
                        renderTimeline();
                        showMessage('删除成功 🗑️', 'success');
                    })
                    .catch(error => {
                        console.error('删除失败:', error);
                        showMessage('删除失败 😢', 'error');
                    });
            }
        } else {
            showMessage('你没有权限删除这条内容 😅', 'error');
        }
    });
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

// 切换回复表单显示
function toggleReplyForm(postId) {
    const replyForm = document.getElementById(`replyForm-${postId}`);
    if (replyForm) {
        replyForm.style.display = replyForm.style.display === 'none' ? 'block' : 'none';
    }
}

// 提交回复
function submitReply(postId) {
    if (!currentUser) {
        showMessage('请先选择用户身份 😅', 'error');
        return;
    }

    const replyForm = document.getElementById(`replyForm-${postId}`);
    const replyInput = replyForm.querySelector('.reply-input');
    const content = replyInput.value.trim();
    
    if (!content) {
        showMessage('回复内容不能为空 😅', 'warning');
        return;
    }
    
    const reply = {
        content: content,
        user: currentUser,
        timestamp: firebase.firestore.Timestamp.now()
    };
    
    db.collection('posts').doc(postId)
        .collection('replies')
        .add(reply)
        .then(() => {
            replyInput.value = '';
            replyForm.style.display = 'none';
            loadReplies(postId);
            showMessage('回复成功 ✨', 'success');
        })
        .catch(error => {
            console.error('回复失败:', error);
            showMessage('回复失败，请重试 😢', 'error');
        });
}

// 切换嵌套回复表单
function toggleNestedReplyForm(postId, replyId, level = 2) {
    const replyContainer = document.querySelector(`[data-reply-id="${replyId}"]`);
    let nestedReplyForm = document.getElementById(`nestedReplyForm-${replyId}`);
    
    if (!nestedReplyForm) {
        nestedReplyForm = document.createElement('div');
        nestedReplyForm.id = `nestedReplyForm-${replyId}`;
        nestedReplyForm.className = 'nested-reply-form';
        nestedReplyForm.innerHTML = `
            <textarea class="reply-input" placeholder="写下你的回复..."></textarea>
            <button class="reply-submit-btn" onclick="submitNestedReply('${postId}', '${replyId}')">
                <i class="fas fa-paper-plane"></i> 发送
            </button>
        `;
        replyContainer.appendChild(nestedReplyForm);
    } else {
        nestedReplyForm.style.display = nestedReplyForm.style.display === 'none' ? 'block' : 'none';
    }
}

// 提交嵌套回复
function submitNestedReply(postId, replyId) {
    if (!currentUser) {
        showMessage('请先选择用户身份 😅', 'error');
        return;
    }

    const nestedReplyForm = document.getElementById(`nestedReplyForm-${replyId}`);
    const replyInput = nestedReplyForm.querySelector('.reply-input');
    const content = replyInput.value.trim();
    
    if (!content) {
        showMessage('回复内容不能为空 😅', 'warning');
        return;
    }
    
    const nestedReply = {
        content: content,
        user: currentUser,
        timestamp: firebase.firestore.Timestamp.now()
    };
    
    db.collection('posts').doc(postId)
        .collection('replies').doc(replyId)
        .collection('nested-replies')
        .add(nestedReply)
        .then(() => {
            replyInput.value = '';
            nestedReplyForm.style.display = 'none';
            loadNestedReplies(postId, replyId);
            showMessage('回复成功 ✨', 'success');
        })
        .catch(error => {
            console.error('回复失败:', error);
            showMessage('回复失败，请重试 😢', 'error');
        });
}

// 删除回复
function deleteReply(postId, replyId) {
    // 先获取回复数据进行权限验证
    db.collection('posts').doc(postId)
        .collection('replies').doc(replyId)
        .get()
        .then(doc => {
            if (doc.exists && doc.data().user === currentUser) {
                if (confirm('确定要删除这条回复吗？')) {
                    db.collection('posts').doc(postId)
                        .collection('replies').doc(replyId)
                        .delete()
                        .then(() => {
                            loadReplies(postId);
                            showMessage('删除成功 🗑️', 'success');
                        })
                        .catch(error => {
                            console.error('删除失败:', error);
                            showMessage('删除失败，请重试 😢', 'error');
                        });
                }
            } else {
                showMessage('你没有权限删除这条回复 😅', 'error');
            }
        });
}

// 删除嵌套回复
function deleteNestedReply(postId, parentId, replyId) {
    // 先获取嵌套回复数据进行权限验证
    db.collection('posts').doc(postId)
        .collection('replies').doc(parentId)
        .collection('nested-replies').doc(replyId)
        .get()
        .then(doc => {
            if (doc.exists && doc.data().user === currentUser) {
                if (confirm('确定要删除这条回复吗？')) {
                    db.collection('posts').doc(postId)
                        .collection('replies').doc(parentId)
                        .collection('nested-replies').doc(replyId)
                        .delete()
                        .then(() => {
                            loadNestedReplies(postId, parentId);
                            showMessage('删除成功 🗑️', 'success');
                        })
                        .catch(error => {
                            console.error('删除失败:', error);
                            showMessage('删除失败，请重试 😢', 'error');
                        });
                }
            } else {
                showMessage('你没有权限删除这条回复 😅', 'error');
            }
        });
}

// 加载回复
function loadReplies(postId) {
    const repliesContainer = document.getElementById(`replies-${postId}`);
    if (!repliesContainer) return;

    db.collection('posts').doc(postId).collection('replies')
        .orderBy('timestamp', 'asc')
        .get()
        .then(snapshot => {
            if (snapshot.empty) {
                repliesContainer.innerHTML = '';
                return;
            }

            const replies = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const repliesHtml = replies.map(reply => {
                const userEmoji = reply.user === '晁森豪' ? '🤴' : '👸';
                const isCurrentUser = reply.user === currentUser;

                return `
                    <div class="reply" data-reply-id="${reply.id}">
                        <div class="reply-header">
                            <span class="reply-user">${reply.user} ${userEmoji}</span>
                            <span class="reply-time">${formatTime(reply.timestamp)}</span>
                            ${isCurrentUser ? `
                                <button class="delete-reply-btn" onclick="deleteReply('${postId}', '${reply.id}')" title="删除">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            ` : ''}
                        </div>
                        <div class="reply-content">${reply.content}</div>
                        <button class="nested-reply-btn" onclick="toggleNestedReplyForm('${postId}', '${reply.id}', 2)">
                            <i class="fas fa-reply"></i> 回复
                        </button>
                        <div class="nested-replies" id="nested-replies-${reply.id}"></div>
                    </div>
                `;
            }).join('');

            repliesContainer.innerHTML = repliesHtml;

            // 加载每条回复的二级回复
            replies.forEach(reply => {
                loadNestedReplies(postId, reply.id, 2);
            });
        });
}

// 修改 loadNestedReplies 函数以支持无限嵌套
function loadNestedReplies(postId, parentId, level = 1) {
    const container = document.getElementById(`nested-replies-${parentId}`);
    if (!container) return;

    const collectionPath = `posts/${postId}/replies/${parentId}/nested-replies`;

    db.collection(collectionPath)
        .orderBy('timestamp', 'asc')
        .get()
        .then(snapshot => {
            if (snapshot.empty) {
                container.innerHTML = '';
                return;
            }

            const nestedReplies = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const nestedRepliesHtml = nestedReplies.map(reply => {
                const userEmoji = reply.user === '晁森豪' ? '🤴' : '👸';
                const isCurrentUser = reply.user === currentUser;

                return `
                    <div class="nested-reply level-${level}" data-reply-id="${reply.id}">
                        <div class="reply-header">
                            <span class="reply-user">${reply.user} ${userEmoji}</span>
                            <span class="reply-time">${formatTime(reply.timestamp)}</span>
                            ${isCurrentUser ? `
                                <button class="delete-reply-btn" onclick="deleteNestedReply('${postId}', '${parentId}', '${reply.id}')" title="删除">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            ` : ''}
                        </div>
                        <div class="reply-content">${reply.content}</div>
                        <button class="nested-reply-btn" onclick="toggleNestedReplyForm('${postId}', '${reply.id}', ${level + 1})">
                            <i class="fas fa-reply"></i> 回复
                        </button>
                        <div class="nested-replies" id="nested-replies-${reply.id}"></div>
                    </div>
                `;
            }).join('');

            container.innerHTML = nestedRepliesHtml;

            // 递归加载每条回复的嵌套回复
            nestedReplies.forEach(reply => {
                loadNestedReplies(postId, reply.id, level + 1);
            });
        });
}

// 修改录音相关函数
async function initVoiceRecording() {
    const recordBtn = document.getElementById('recordVoiceBtn');
    let isRecording = false;
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('浏览器不支持录音功能');
        recordBtn.disabled = true;
        recordBtn.innerHTML = '<i class="fas fa-microphone-slash"></i> 不支持录音';
        return;
    }
    
    recordBtn.addEventListener('click', async function() {
        try {
            if (!isRecording) {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                // 设置适当的音频格式
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                mediaRecorder = new MediaRecorder(stream, {
                    mimeType: isIOS ? 'audio/mp4' : 'audio/webm;codecs=opus',
                    audioBitsPerSecond: 128000
                });
                
                audioChunks = [];
                
                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        audioChunks.push(event.data);
                    }
                };
                
                mediaRecorder.onstop = async () => {
                    // 停止所有音轨
                    stream.getTracks().forEach(track => track.stop());
                    
                    // 创建音频预览
                    const audioBlob = new Blob(audioChunks, { 
                        type: isIOS ? 'audio/mp4' : 'audio/webm'
                    });
                    const audioUrl = URL.createObjectURL(audioBlob);
                    
                    // 显示预览
                    const previewContainer = document.createElement('div');
                    previewContainer.className = 'voice-preview-container';
                    
                    const audioPreview = document.createElement('audio');
                    audioPreview.controls = true;
                    audioPreview.src = audioUrl;
                    
                    // 清除旧的预览
                    const oldPreview = document.querySelector('.voice-preview-container');
                    if (oldPreview) {
                        oldPreview.remove();
                    }
                    
                    previewContainer.appendChild(audioPreview);
                    recordBtn.parentElement.appendChild(previewContainer);
                    
                    stopRecordingTimer();
                    showMessage('录音完成 ✅', 'success');
                };
                
                // 每秒收集数据
                mediaRecorder.start(1000);
                isRecording = true;
                recordBtn.innerHTML = '<i class="fas fa-stop"></i> 停止录音';
                showMessage('开始录音... 🎤', 'info');
                startRecordingTimer();
                
            } else {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
                isRecording = false;
                recordBtn.innerHTML = '<i class="fas fa-microphone"></i> 开始录音';
            }
        } catch (error) {
            console.error('录音失败:', error);
            showMessage('无法访问麦克风，请检查权限设置 🎤', 'error');
            recordBtn.innerHTML = '<i class="fas fa-microphone"></i> 开始录音';
            isRecording = false;
        }
    });
}

// 添加录音计时器函数
function startRecordingTimer() {
    recordingDuration = 0;
    const timerEl = document.querySelector('.voice-timer');
    timerEl.style.display = 'block';
    timerEl.textContent = '00:00';
    
    recordingTimer = setInterval(() => {
        recordingDuration++;
        const minutes = Math.floor(recordingDuration / 60);
        const seconds = recordingDuration % 60;
        timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // 到达最大时长时自动停止
        if (recordingDuration >= MAX_RECORDING_TIME) {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                mediaRecorder.stream.getTracks().forEach(track => track.stop());
                showMessage('已达到最大录音时长 ⏱️', 'warning');
            }
        }
    }, 1000);
}

// 添加停止计时器函数
function stopRecordingTimer() {
    if (recordingTimer) {
        clearInterval(recordingTimer);
        const timerEl = document.querySelector('.voice-timer');
        timerEl.style.display = 'none';
    }
}

// 修改上传语音函数
async function uploadVoice(voiceBlob) {
    try {
        console.log('开始处理语音文件...');
        
        // 压缩音频质量
        const compressedBlob = await compressAudio(voiceBlob);
        
        // 如果文件仍然太大，将其分片存储
        if (compressedBlob.size > 900000) { // 900KB
            console.log('文件较大，进行分片存储...');
            const chunks = await splitAudioIntoChunks(compressedBlob);
            return {
                type: 'chunks',
                chunks: chunks
            };
        } else {
            // 转换为 base64
            const base64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(compressedBlob);
            });
            return {
                type: 'single',
                data: base64
            };
        }
    } catch (error) {
        console.error('语音处理失败:', error);
        throw new Error('语音处理失败');
    }
}

// 修改音频压缩函数
async function compressAudio(blob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // 创建离线上下文，使用更合理的采样率
    const offlineContext = new OfflineAudioContext(
        1, // 单声道
        audioBuffer.length, 
        32000 // 使用32kHz的采样率
    );
    
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();
    
    const renderedBuffer = await offlineContext.startRendering();
    const compressedBlob = await new Promise(resolve => {
        const mediaStreamDestination = audioContext.createMediaStreamDestination();
        const mediaRecorder = new MediaRecorder(mediaStreamDestination.stream, {
            mimeType: 'audio/webm;codecs=opus',
            bitsPerSecond: 96000 // 增加到96kbps，保证音质
        });
        
        const chunks = [];
        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
        
        mediaRecorder.start();
        const source = audioContext.createBufferSource();
        source.buffer = renderedBuffer;
        source.connect(mediaStreamDestination);
        source.start();
        setTimeout(() => mediaRecorder.stop(), renderedBuffer.duration * 1000);
    });
    
    return compressedBlob;
}

// 修改分片大小
async function splitAudioIntoChunks(blob) {
    const chunkSize = 500000; // 减小到500KB
    const chunks = [];
    let offset = 0;
    
    while (offset < blob.size) {
        const chunk = blob.slice(offset, offset + chunkSize);
        const base64Chunk = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(chunk);
        });
        chunks.push(base64Chunk);
        offset += chunkSize;
    }
    
    return chunks;
}

// 修改图片压缩函数
async function compressImage(file) {
    return new Promise((resolve, reject) => {
        const maxWidth = 1200;
        const maxHeight = 1200;
        const maxSizeMB = 0.5; // 压缩到500KB以下
        
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = function(e) {
            const img = new Image();
            img.src = e.target.result;
            
            img.onload = function() {
                let width = img.width;
                let height = img.height;
                
                // 如果图片尺寸过大，按比例缩小
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width *= ratio;
                    height *= ratio;
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // 逐步降低质量直到文件大小符合要求
                let quality = 0.7;
                let base64 = canvas.toDataURL('image/jpeg', quality);
                
                while (base64.length > maxSizeMB * 1024 * 1024 && quality > 0.1) {
                    quality -= 0.1;
                    base64 = canvas.toDataURL('image/jpeg', quality);
                }
                
                resolve(base64);
            };
            
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// 添加生成缩略图函数
async function generateThumbnail(imageUrl, maxWidth = 300, maxHeight = 300) {
    // 检查缓存
    const cacheKey = `thumb_${imageUrl}_${maxWidth}_${maxHeight}`;
    if (imageCache.has(cacheKey)) {
        return imageCache.get(cacheKey);
    }
    
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = function() {
            let width = img.width;
            let height = img.height;
            
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio;
                height *= ratio;
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            const thumbnail = canvas.toDataURL('image/jpeg', 0.5);
            // 缓存缩略图
            imageCache.set(cacheKey, thumbnail);
            resolve(thumbnail);
        };
        img.src = imageUrl;
    });
}

// 修改 renderImages 函数，优化图片加载
function renderImages(images, container) {
    if (!images || !images.length) return '';
    
    const imageElements = images.map((imageUrl, index) => {
        // 生成唯一ID
        const imageId = `image-${Date.now()}-${index}`;
        
        // 使用 IntersectionObserver 优化图片加载
        setTimeout(() => {
            const imgEl = document.getElementById(imageId);
            if (imgEl) {
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            generateThumbnail(imageUrl).then(thumbnail => {
                                imgEl.src = thumbnail;
                                imgEl.dataset.fullImage = imageUrl;
                                
                                // 添加点击事件
                                imgEl.addEventListener('click', function() {
                                    const modal = document.getElementById('imagePreviewModal');
                                    const modalImg = document.getElementById('previewImage');
                                    modalImg.src = thumbnail;
                                    modal.style.display = 'block';
                                    
                                    // 加载原图
                                    const fullImg = new Image();
                                    fullImg.onload = function() {
                                        modalImg.src = imageUrl;
                                    };
                                    fullImg.src = imageUrl;
                                });
                                
                                observer.disconnect();
                            });
                        }
                    });
                });
                
                observer.observe(imgEl);
            }
        }, 0);
        
        return `<img id="${imageId}" class="timeline-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="加载中...">`;
    }).join('');
    
    return `<div class="image-container">${imageElements}</div>`;
}

// 添加图片预览模态框的关闭事件
document.querySelector('.close-modal').addEventListener('click', function() {
    document.getElementById('imagePreviewModal').style.display = 'none';
});

// 添加 formatTime 函数
function formatTime(timestamp) {
    if (timestamp instanceof firebase.firestore.Timestamp) {
        timestamp = timestamp.toDate();
    }
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
    return new Intl.DateTimeFormat('zh-CN', options).format(timestamp);
}

// 添加加载提示函数
function showLoadingIndicator(show = true) {
    let loadingEl = document.querySelector('.loading-more');
    if (!loadingEl) {
        loadingEl = document.createElement('div');
        loadingEl.className = 'loading-more';
        loadingEl.innerHTML = '加载更多内容... 🌈';
        document.querySelector('.timeline').appendChild(loadingEl);
    }
    loadingEl.style.display = show ? 'block' : 'none';
}

// 添加滚动加载功能
function setupInfiniteScroll() {
    const timelineEl = document.querySelector('.timeline');
    let isLoading = false;
    let hasMorePosts = true;
    
    window.addEventListener('scroll', async () => {
        // 检查是否到达底部
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100) {
            if (!isLoading && hasMorePosts) {
                isLoading = true;
                
                // 显示加载提示
                const loadingIndicator = document.createElement('div');
                loadingIndicator.className = 'loading-indicator';
                loadingIndicator.textContent = '正在加载内容... 📃';
                timelineEl.appendChild(loadingIndicator);
                
                try {
                    // 加载下一页数据
                    const result = await loadPosts(lastVisiblePost);
                    
                    if (result.posts.length === 0) {
                        hasMorePosts = false;
                        loadingIndicator.textContent = '已经到底啦 🎈';
                        setTimeout(() => {
                            loadingIndicator.remove();
                        }, 2000);
                    } else {
                        lastVisiblePost = result.posts[result.posts.length - 1].timestamp;
                        loadingIndicator.remove();
                    }
                } catch (error) {
                    console.error('加载更多内容失败:', error);
                    loadingIndicator.textContent = '加载失败，请重试 😢';
                    setTimeout(() => {
                        loadingIndicator.remove();
                    }, 2000);
                }
                
                isLoading = false;
            }
        }
    });
}

// 添加加载指示器函数
function showLoadingIndicator(show) {
    let loadingEl = document.querySelector('.loading-indicator');
    if (!loadingEl) {
        loadingEl = document.createElement('div');
        loadingEl.className = 'loading-indicator';
        loadingEl.innerHTML = '加载中... 🚀';
        document.querySelector('.timeline-wrapper').appendChild(loadingEl);
    }
    
    loadingEl.style.display = show ? 'block' : 'none';
}

// 添加相关CSS样式

// 添加身份选择功能
function selectUser(username) {
    currentUser = username;
    
    // 切换显示
    const modalEl = document.getElementById('userSelectModal');
    const containerEl = document.querySelector('.container');
    
    modalEl.style.display = 'none';
    containerEl.style.display = 'block';
    
    // 显示欢迎消息
    showMessage(`欢迎回来，${username} ${username === '晁森豪' ? '🤴' : '👸'}`, 'success');
    
    // 初始化应用
    initializeApp();
}

// 修改初始化应用函数
function initializeApp() {
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
    setupInfiniteScroll(); // 添加滚动加载功能
}

// 初始化时添加离线持久化
firebase.firestore().enablePersistence()
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('多个标签页打开，离线持久化只能在一个标签页中启用');
        } else if (err.code == 'unimplemented') {
            console.log('当前浏览器不支持离线持久化');
        }
    });

// 修改渲染帖子函数
function renderPost(post) {
    const postEl = document.createElement('div');
    postEl.className = 'timeline-item';
    postEl.setAttribute('data-user', post.user);
    
    // 创建帖子内容
    const contentEl = document.createElement('div');
    contentEl.className = 'timeline-content';
    
    // 添加文本内容
    if (post.content) {
        const textEl = document.createElement('div');
        textEl.className = 'timeline-text';
        textEl.textContent = post.content;
        contentEl.appendChild(textEl);
    }
    
    // 处理语音
    if (post.voice) {
        const voiceContainer = document.createElement('div');
        voiceContainer.className = 'voice-preview-container';
        
        const audioEl = document.createElement('audio');
        audioEl.className = 'voice-player';
        audioEl.controls = true;
        audioEl.preload = 'metadata';
        audioEl.src = post.voice;
        
        voiceContainer.appendChild(audioEl);
        contentEl.appendChild(voiceContainer);
    }
    
    postEl.appendChild(contentEl);
    return postEl;
}
