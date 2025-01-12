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

function loadPosts(lastTimestamp = null, limit = POSTS_PER_PAGE, retryCount = 3) {
    console.log('开始加载帖子...');
    
    const timelineEl = document.querySelector('.timeline');
    if (currentPage === 1) {
        timelineEl.innerHTML = '<div class="loading-indicator">加载中... 💫</div>';
    }
    
    let query = db.collection('posts')
        .orderBy('timestamp', 'desc')
        .limit(limit);
    
    if (lastTimestamp) {
        query = query.startAfter(lastTimestamp);
    }
    
    return query.get()
        .then(snapshot => {
            if (snapshot.empty) {
                if (currentPage === 1) {
                    const timelineEl = document.querySelector('.timeline');
                    timelineEl.innerHTML = '<div class="timeline-empty">还没有任何记录哦 ✨</div>';
                }
                return { posts: [], hasMore: false };
            }
            
            const posts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            // 更新数据
            if (currentPage === 1) {
                timelineData = [...posts];
            } else {
                // 确保不重复添加数据
                const newPosts = posts.filter(post => 
                    !timelineData.some(existing => existing.id === post.id)
                );
                timelineData = [...timelineData, ...newPosts];
            }
            
            // 更新最后一条记录的引用
            lastVisiblePost = snapshot.docs[snapshot.docs.length - 1];
            
            requestAnimationFrame(() => {
                renderTimeline(currentPage > 1); // 只有加载更多时保持滚动位置
            });
            
            return {
                posts,
                hasMore: posts.length === limit
            };
        })
        .catch(error => {
            console.error('加载帖子失败:', error);
            
            // 如果还有重试次数，则重试
            if (retryCount > 0) {
                console.log(`还有 ${retryCount} 次重试机会，1秒后重试...`);
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve(loadPosts(lastTimestamp, limit, retryCount - 1));
                    }, 1000);
                });
            }
            
            showMessage('加载失败，请检查网络连接 🔄', 'error');
            return { posts: [], hasMore: false };
        });
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

    const html = timelineData.map(post => {
        // 处理图片内容
        const imageContent = post.images ? renderImages(post.images, timelineEl) : '';
        
        // 处理语音内容
        const voiceContent = post.voice ? `
            <div class="voice-preview-container">
                <audio controls src="${post.voice}"></audio>
            </div>
        ` : '';

        // 获取表情
        const moodEmoji = getMoodEmoji(post.mood);
        const userEmoji = post.user === '晁森豪' ? '🤴' : '👸';

        // 使用全局 currentUser 进行判断
        const isCurrentUser = post.user === currentUser;

        // 添加删除按钮（仅对应用户可见）
        const deleteButton = `
            <button class="delete-post-btn" onclick="deletePost('${post.id}')" 
                    style="display: ${isCurrentUser ? 'inline-block' : 'none'}"
                    title="删除">
                <i class="fas fa-trash-alt"></i>
            </button>
        `;

        return `
            <div class="timeline-item" data-user="${post.user}">
                <div class="post-header">
                    <span class="post-user">${post.user} ${userEmoji}</span>
                    <span class="post-time">${formatTime(post.timestamp)}</span>
                    ${deleteButton}
                </div>
                <div class="post-content">${post.content}</div>
                ${imageContent}
                ${voiceContent}
                <div class="post-mood">${moodEmoji} ${post.mood}</div>
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
        `;
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
    console.log('设置实时更新监听...');
    
    let initialLoad = true;
    
    db.collection('posts')
        .orderBy('timestamp', 'desc')
        .onSnapshot(snapshot => {
            const changes = snapshot.docChanges();
            console.log('收到实时更新:', changes.length, '条变更');
            
            // 忽略首次加载
            if (initialLoad) {
                initialLoad = false;
                return;
            }
            
            // 处理增量更新
            changes.forEach(change => {
                const post = {
                    id: change.doc.id,
                    ...change.doc.data()
                };
                
                if (change.type === 'added') {
                    console.log('新增帖子:', post);
                    // 检查是否是新发布的帖子（最近5秒内）
                    const isNewPost = post.timestamp && 
                        (Date.now() - post.timestamp.toMillis() < 5000);
                    
                    if (!timelineData.some(p => p.id === post.id)) {
                        if (isNewPost) {
                            timelineData.unshift(post);
                        }
                        requestAnimationFrame(() => {
                            renderTimeline(true); // true 表示保持滚动位置
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
        }, error => {
            console.error('监听更新失败:', error);
            showMessage('实时更新连接失败，请刷新页面 🔄', 'error');
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
    const loadingEl = document.getElementById('loading');
    const voicePreview = document.getElementById('voicePreview');
    
    if (!content) {
        showMessage('请输入内容 ✍️', 'warning');
        return;
    }

    loadingEl.style.display = 'block';
    
    try {
        const post = {
            content: content,
            mood: mood,
            user: currentUser, // 使用当前用户
            timestamp: firebase.firestore.Timestamp.fromDate(new Date()),
            date: new Date().toISOString().split('T')[0]
        };

        // 处理图片上传
        if (imageFiles.length > 0) {
            showMessage('正在上传图片...', 'info');
            const images = [];
            for (const file of imageFiles) {
                try {
                    const imageUrl = await uploadImage(file);
                    images.push(imageUrl);
                } catch (error) {
                    console.error('图片上传失败:', error);
                    showMessage('图片上传失败 😢', 'error');
                    return;
                }
            }
            post.images = images;
        }
        
        // 处理语音
        if (voicePreview && voicePreview.src && voicePreview.src.startsWith('data:audio')) {
            try {
                showMessage('正在处理语音...', 'info');
                post.voice = voicePreview.src;
                console.log('语音数据已添加到帖子');
            } catch (error) {
                console.error('语音处理失败:', error);
                showMessage('语音处理失败，但会继续发布文字内容 🎤', 'warning');
            }
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

// 初始化语音录制功能
async function initVoiceRecording() {
    const recordBtn = document.getElementById('recordVoiceBtn');
    const timer = document.querySelector('.voice-timer');
    const voicePreview = document.getElementById('voicePreview');

    recordBtn.addEventListener('click', async () => {
        if (!mediaRecorder) {
            try {
                // 添加 Safari 浏览器的特殊处理
                const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
                if (isSafari) {
                    showMessage('Safari浏览器需要在设置中允许使用麦克风 🎤\n设置 > Safari > 高级 > 网站设置 > 麦克风', 'warning');
                }

                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                // 检测设备类型并设置适当的音频格式
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                
                try {
                    mediaRecorder = new MediaRecorder(stream, {
                        mimeType: isIOS ? 'audio/mp4' : 'audio/webm;codecs=opus',
                        audioBitsPerSecond: 128000
                    });
                } catch (e) {
                    // 如果指定格式失败，尝试使用默认格式
                    console.log('指定格式失败，使用默认格式');
                    mediaRecorder = new MediaRecorder(stream);
                }
                
                audioChunks = [];

                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = async () => {
                    try {
                        // 创建音频 Blob
                        const audioBlob = new Blob(audioChunks, { 
                            type: 'audio/mpeg' // 使用更通用的格式
                        });
                        
                        // 转换为 Base64
                        const base64Audio = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(audioBlob);
                        });

                        // 预览音频
                        voicePreview.src = base64Audio;
                        voicePreview.style.display = 'block';
                        
                        // 确保音频加载完成
                        await new Promise((resolve, reject) => {
                            voicePreview.onloadeddata = resolve;
                            voicePreview.onerror = reject;
                        });

                        console.log('音频加载成功');
                        showMessage('录音完成 ✅', 'success');
                        
                    } catch (error) {
                        console.error('处理录音数据失败:', error);
                        showMessage('处理录音失败，请重试 🎤', 'error');
                    }
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

// 添加图片压缩函数
async function compressImage(file) {
    return new Promise((resolve, reject) => {
        const maxWidth = 1200;
        const maxHeight = 1200;
        const maxSizeMB = 1;
        
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = function(e) {
            const img = new Image();
            img.src = e.target.result;
            
            img.onload = function() {
                let width = img.width;
                let height = img.height;
                
                // 计算缩放比例
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
                
                let quality = 0.8;
                let base64 = canvas.toDataURL('image/jpeg', quality);
                
                // 如果大小仍然超过限制，继续压缩
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

// 修改 uploadImage 函数
async function uploadImage(file) {
    try {
        // 检查文件大小
        if (file.size > 2 * 1024 * 1024) { // 2MB
            showMessage('图片太大，正在压缩...', 'info');
            const compressedImage = await compressImage(file);
            return compressedImage;
        }
        
        // 如果文件不需要压缩，直接转换为 base64
        const reader = new FileReader();
        return new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => {
                console.error('图片读取失败:', reader.error);
                reject(new Error('图片读取失败'));
            };
            reader.readAsDataURL(file);
        });
    } catch (error) {
        console.error('图片处理失败:', error);
        showMessage('图片处理失败，请重试 📸', 'error');
        throw new Error('图片处理失败');
    }
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

// 修改无限滚动的实现
function setupInfiniteScroll() {
    const timelineWrapper = document.querySelector('.timeline-wrapper');
    let isLoading = false;
    let scrollTimeout = null;
    
    timelineWrapper.addEventListener('scroll', () => {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        
        scrollTimeout = setTimeout(() => {
            const { scrollTop, scrollHeight, clientHeight } = timelineWrapper;
            const threshold = 100; // 滚动阈值
            
            if (scrollHeight - scrollTop - clientHeight < threshold && !isLoading && lastVisiblePost) {
                isLoading = true;
                currentPage++;
                
                // 显示加载提示
                showLoadingIndicator(true);
                
                loadPosts(lastVisiblePost)
                    .then(() => {
                        isLoading = false;
                        // 隐藏加载提示
                        showLoadingIndicator(false);
                    })
                    .catch(() => {
                        isLoading = false;
                        currentPage--;
                        // 隐藏加载提示
                        showLoadingIndicator(false);
                    });
            }
        }, 150);
    });
}

// 在初始化时调用
setupInfiniteScroll();

// 添加实时更新处理
function handleRealtimeUpdate(change) {
    console.log('收到实时更新:', change);
    
    // 更新缓存
    postCache.clear(); // 清除缓存，强制重新加载
    
    // 重新加载数据
    currentPage = 1;
    loadPosts();
}

// 添加网络状态监听
function setupNetworkListener() {
    let isReconnecting = false;

    // 监听在线状态
    window.addEventListener('online', () => {
        console.log('网络已连接');
        showMessage('网络已恢复 🌐', 'success');
        if (!isReconnecting) {
            isReconnecting = true;
            // 重新加载数据
            loadPosts()
                .then(() => {
                    isReconnecting = false;
                })
                .catch(() => {
                    isReconnecting = false;
                });
        }
    });

    window.addEventListener('offline', () => {
        console.log('网络已断开');
        showMessage('网络已断开，将使用离线数据 📴', 'warning');
    });
}

// 在初始化时调用
setupNetworkListener();

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
}
