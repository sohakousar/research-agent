/**
 * Antigravity - Autonomous Research Console JS Application
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const providerSelect = document.getElementById('provider-select');
    const modelInput = document.getElementById('model-input');
    const apiKeyInput = document.getElementById('api-key-input');
    const togglePasswordBtn = document.getElementById('toggle-password-btn');
    const queryInput = document.getElementById('query-input');
    const startResearchBtn = document.getElementById('start-research-btn');
    const cancelResearchBtn = document.getElementById('cancel-research-btn');
    const historyList = document.getElementById('history-list');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    // Connection Status
    const connectionDot = document.getElementById('connection-dot');
    const connectionText = document.getElementById('connection-text');

    // Stats Counter Elements
    const statSubquestions = document.getElementById('stat-subquestions');
    const statSearches = document.getElementById('stat-searches');
    const statFetched = document.getElementById('stat-fetched');
    const statNotes = document.getElementById('stat-notes');
    const statIterations = document.getElementById('stat-iterations');

    // Tab buttons & contents
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Workspace tabs contents
    const timelineEvents = document.getElementById('timeline-events');
    const reportContainer = document.getElementById('report-container');
    const sidebarSubquestions = document.getElementById('sidebar-subquestions');
    const notesGrid = document.getElementById('notes-grid');
    const reportTabBtn = document.getElementById('report-tab-btn');

    // Notification toast
    const toast = document.getElementById('notification-toast');
    const toastMessage = document.getElementById('notification-message');

    // Application State Variables
    let activeStreamController = null;
    let runHistory = [];
    let currentRunData = {
        subquestions: [],
        notes: [],
        searches: 0,
        searchQueries: [],
        fetched: 0,
        fetchedUrls: [],
        iterations: 0,
        thoughts: [],
        status: 'idle',
        events: []
    };

    // Default models mapping
    const defaultModels = {
        gemini: 'gemini-3.8-flash',
        openai: 'gpt-4o-mini',
        mock: 'mock-model',
        groq: 'openai/gpt-oss-120b'
    };

    // Initialize application
    init();

    function init() {
        checkBackendHealth();
        loadSettings();
        loadHistory();
        setupEventListeners();
        initAnimations();
    }

    // Check FastAPI Backend Connection
    async function checkBackendHealth() {
        try {
            const res = await fetch('/');
            if (res.ok) {
                // If it is our HTML page, checking accept headers works, but general response is 200
                connectionDot.className = 'status-dot green pulsing';
                connectionText.textContent = 'Backend Online';
            } else {
                setBackendOffline();
            }
        } catch (e) {
            setBackendOffline();
        }
    }

    function setBackendOffline() {
        connectionDot.className = 'status-dot red';
        connectionText.textContent = 'Backend Offline';
        showToast('Cannot connect to FastAPI backend server.', 'error');
    }

    // LocalStorage Run History
    function loadHistory() {
        try {
            const stored = localStorage.getItem('research_run_history');
            if (stored) {
                runHistory = JSON.parse(stored);
                renderHistory();

                // Automatically load and select the most recent run on startup
                if (runHistory.length > 0) {
                    const firstItem = historyList.querySelector('.history-item');
                    loadHistoryRun(runHistory[0], firstItem);
                }
            }
        } catch (e) {
            console.error('Failed to load history:', e);
        }
    }

    function saveHistory() {
        try {
            localStorage.setItem('research_run_history', JSON.stringify(runHistory));
            renderHistory();
        } catch (e) {
            console.error('Failed to save history:', e);
        }
    }

    function renderHistory() {
        if (runHistory.length === 0) {
            historyList.innerHTML = `
                <div class="history-placeholder">
                    <i class="fa-solid fa-folder-open"></i>
                    <p>No previous runs found</p>
                </div>
            `;
            return;
        }

        historyList.innerHTML = '';
        runHistory.forEach((run, index) => {
            const date = new Date(run.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const item = document.createElement('div');
            item.className = 'history-item';
            item.dataset.index = index;

            item.innerHTML = `
                <div class="history-details">
                    <div class="history-query" title="${run.query}">${escapeHtml(run.query)}</div>
                    <div class="history-meta">
                        <span><i class="fa-solid fa-microchip"></i> ${run.provider}</span>
                        <span><i class="fa-solid fa-clock"></i> ${date}</span>
                    </div>
                </div>
                <button class="history-delete" data-index="${index}" title="Delete this run">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;

            item.addEventListener('click', (e) => {
                // If clicked delete button
                if (e.target.closest('.history-delete')) return;
                loadHistoryRun(run, item);
            });

            // Delete item handler
            item.querySelector('.history-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                runHistory.splice(index, 1);
                saveHistory();
                showToast('Run deleted from history.', 'info');
            });

            historyList.appendChild(item);
        });
    }

    // Load run from history into UI
    function loadHistoryRun(run, element) {
        // Toggle active styling
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
        if (element) element.classList.add('active');

        // Populate details
        queryInput.value = run.query;
        providerSelect.value = run.provider;
        modelInput.value = run.model || defaultModels[run.provider] || '';

        // Update stats
        statSubquestions.textContent = run.subquestions?.length || 0;
        statSearches.textContent = run.searches || 0;
        statFetched.textContent = run.fetched || 0;
        statNotes.textContent = run.notes?.length || 0;
        statIterations.textContent = run.iterations || 0;

        // Render report
        renderFinalReport(run.result, run.query, new Date(run.timestamp));

        // Render notes
        renderNotesTab(run.subquestions || [], run.notes || []);

        // Populate Timeline with historical log summaries
        timelineEvents.innerHTML = `
            <div class="timeline-item status">
                <div class="timeline-node"><i class="fa-solid fa-info"></i></div>
                <div class="timeline-meta">Historical Data Loaded</div>
                <div class="timeline-content">
                    Loaded results from run conducted on ${new Date(run.timestamp).toLocaleString()}.
                    <br><strong style="color: var(--accent-teal)">Query:</strong> ${escapeHtml(run.query)}
                </div>
            </div>
        `;
        if (run.notes) {
            run.notes.forEach(note => {
                appendTimelineItem('note', `Extracted finding from ${note.source_url}: "${note.finding}"`);
            });
        }

        // Render and append the report directly to the timeline also
        if (run.result) {
            const reportHtml = getReportHtml(run.result, run.query, new Date(run.timestamp));
            appendTimelineItem('report', reportHtml);
        }

        // Restore details for interactive modals
        currentRunData.subquestions = run.subquestions || [];
        currentRunData.notes = run.notes || [];
        currentRunData.searches = run.searches || 0;
        currentRunData.searchQueries = run.searchQueries || [];
        currentRunData.fetched = run.fetched || 0;
        currentRunData.fetchedUrls = run.fetchedUrls || [];
        currentRunData.iterations = run.iterations || 0;
        currentRunData.thoughts = run.thoughts || [];

        appendTimelineItem('finish', 'Agent search successfully completed.');

        // Show report tab
        switchTab('report-tab');
        showToast('Loaded past research findings.', 'success');
    }

    // Set event handlers
    function setupEventListeners() {
        // Toggle password show/hide
        togglePasswordBtn.addEventListener('click', () => {
            const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
            apiKeyInput.setAttribute('type', type);
            const icon = togglePasswordBtn.querySelector('i');
            if (type === 'text') {
                icon.className = 'fa-regular fa-eye-slash';
            } else {
                icon.className = 'fa-regular fa-eye';
            }
        });

        // Provider dropdown model autofill
        providerSelect.addEventListener('change', () => {
            const prov = providerSelect.value;
            modelInput.value = defaultModels[prov] || '';
            saveSettings();
        });

        modelInput.addEventListener('input', saveSettings);
        apiKeyInput.addEventListener('input', saveSettings);

        // Start research
        startResearchBtn.addEventListener('click', startResearch);

        // Cancel/Interrupt research
        cancelResearchBtn.addEventListener('click', interruptResearch);

        // Clear all history
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all research history?')) {
                runHistory = [];
                saveHistory();
                showToast('All history cleared.', 'info');
            }
        });

        // Tab selection click handler
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                switchTab(target);
            });
        });

        // Copy timeline report button handler
        timelineEvents.addEventListener('click', (e) => {
            const copyBtn = e.target.closest('.timeline-copy-report-btn');
            if (!copyBtn) return;
            const textToCopy = copyBtn.dataset.reportText;
            navigator.clipboard.writeText(textToCopy)
                .then(() => showToast('Report copied to clipboard!', 'success'))
                .catch(() => showToast('Failed to copy text.', 'error'));
        });

        // Clicking stat cards opens interactive detail modals
        document.querySelectorAll('.stat-card').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent standard anchor hashtag jump
                const label = card.querySelector('.stat-label').textContent.toLowerCase();

                if (label.includes('sub-questions')) {
                    let html = '<ul class="modal-list">';
                    if (!currentRunData.subquestions || currentRunData.subquestions.length === 0) {
                        html += '<li class="modal-list-item text-muted">No sub-questions generated yet.</li>';
                    } else {
                        currentRunData.subquestions.forEach((q, idx) => {
                            html += `<li class="modal-list-item"><strong>${idx + 1}.</strong> ${escapeHtml(q)}</li>`;
                        });
                    }
                    html += '</ul>';
                    showStatsModal('Sub-Questions Identified', html);
                }
                else if (label.includes('searches')) {
                    let html = '<ul class="modal-list">';
                    if (!currentRunData.searchQueries || currentRunData.searchQueries.length === 0) {
                        html += '<li class="modal-list-item text-muted">No web searches conducted yet.</li>';
                    } else {
                        currentRunData.searchQueries.forEach((q, idx) => {
                            const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
                            html += `
                                <li class="modal-list-item search-item" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                                    <span><strong>${idx + 1}.</strong> "${escapeHtml(q)}"</span>
                                    <a href="${searchUrl}" target="_blank" class="source-link-card" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; white-space: nowrap; margin-top: 0;">
                                        <i class="fa-solid fa-square-arrow-up-right"></i> Search DDG
                                    </a>
                                </li>`;
                        });
                    }
                    html += '</ul>';
                    showStatsModal('Web Searches Conducted', html);
                }
                else if (label.includes('pages')) {
                    let html = '<ul class="modal-list">';
                    if (!currentRunData.fetchedUrls || currentRunData.fetchedUrls.length === 0) {
                        html += '<li class="modal-list-item text-muted">No pages read yet.</li>';
                    } else {
                        currentRunData.fetchedUrls.forEach((url, idx) => {
                            html += `
                                <li class="modal-list-item fetch-item" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;"><strong>${idx + 1}.</strong> ${escapeHtml(url)}</span>
                                    <a href="${url}" target="_blank" class="source-link-card" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; white-space: nowrap; margin-top: 0;">
                                        <i class="fa-solid fa-globe"></i> Visit Site
                                    </a>
                                </li>`;
                        });
                    }
                    html += '</ul>';
                    showStatsModal('Pages Read & Analyzed', html);
                }
                else if (label.includes('notes')) {
                    let html = '<ul class="modal-list">';
                    if (!currentRunData.notes || currentRunData.notes.length === 0) {
                        html += '<li class="modal-list-item text-muted">No note cards saved yet.</li>';
                    } else {
                        currentRunData.notes.forEach((note, idx) => {
                            html += `
                                <li class="modal-list-item note-item">
                                    <p style="margin-bottom: 0.5rem; font-size: 0.88rem; color: var(--text-primary);">"${escapeHtml(note.finding)}"</p>
                                    <a href="${note.source_url}" target="_blank" class="note-source" style="font-size: 0.72rem; color: var(--accent-teal);">
                                        <i class="fa-solid fa-link"></i> ${escapeHtml(note.source_url)}
                                    </a>
                                </li>`;
                        });
                    }
                    html += '</ul>';
                    showStatsModal('Research Database (Saved Notes)', html);
                }
                else if (label.includes('turns')) {
                    let html = '<ul class="modal-list">';
                    if (!currentRunData.thoughts || currentRunData.thoughts.length === 0) {
                        html += '<li class="modal-list-item text-muted">No turns recorded yet.</li>';
                    } else {
                        currentRunData.thoughts.forEach((thought, idx) => {
                            html += `
                                <li class="modal-list-item thought-item">
                                    <strong>Iteration ${idx + 1} Reasoning:</strong>
                                    <p style="margin-top: 0.4rem; white-space: pre-wrap; font-size: 0.85rem; line-height: 1.5;">${escapeHtml(thought)}</p>
                                </li>`;
                        });
                    }
                    html += '</ul>';
                    showStatsModal('Agent Loop Iterations & Thoughts', html);
                }
            });
        });
    }

    // Switch View Tabs
    function switchTab(tabId) {
        tabButtons.forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        tabContents.forEach(content => {
            if (content.id === tabId) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });
    }

    // Main Run Trigger
    async function startResearch() {
        const query = queryInput.value.trim();
        if (!query) {
            showToast('Please enter a research query.', 'error');
            queryInput.focus();
            return;
        }

        const provider = providerSelect.value;
        const model = modelInput.value.trim() || defaultModels[provider];
        const apiKey = apiKeyInput.value.trim();

        // Initialize/reset states
        currentRunData = {
            subquestions: [],
            notes: [],
            searches: 0,
            searchQueries: [],
            fetched: 0,
            fetchedUrls: [],
            iterations: 0,
            thoughts: [],
            status: 'running',
            events: []
        };

        // UI Updates for active execution
        resetStats();
        timelineEvents.innerHTML = '';
        reportContainer.innerHTML = `
            <div class="report-placeholder">
                <i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-teal); font-size: 2.5rem;"></i>
                <h3>Research Agent is Active</h3>
                <p>The agent is currently browsing resources and building the document. Please view the live agent loop timeline for active status updates.</p>
            </div>
        `;
        sidebarSubquestions.innerHTML = '<li class="empty-list">Gathering sub-questions...</li>';
        notesGrid.innerHTML = `
            <div class="notes-placeholder">
                <i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-teal); font-size: 2rem; margin-bottom: 0.8rem;"></i>
                <p>Awaiting note cards extraction from web content...</p>
            </div>
        `;

        startResearchBtn.disabled = true;
        cancelResearchBtn.disabled = false;
        providerSelect.disabled = true;
        modelInput.disabled = true;
        apiKeyInput.disabled = true;
        queryInput.disabled = true;

        switchTab('timeline-tab');
        showToast('Launching autonomous agent loop...', 'info');
        connectionDot.className = 'status-dot orange pulsing';
        connectionText.textContent = 'Agent Running...';

        // Prepare request body
        const payload = {
            query: query,
            provider: provider,
            model: model
        };
        if (apiKey) payload.api_key = apiKey;

        // Custom headers
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        };
        if (apiKey) {
            if (provider === 'gemini') headers['X-Gemini-Key'] = apiKey;
            if (provider === 'openai') headers['X-OpenAI-Key'] = apiKey;
            if (provider === 'groq') headers['X-Groq-Key'] = apiKey;
        }

        // Spawn SSE streaming connection using custom fetch stream reader
        try {
            const controller = new AbortController();
            activeStreamController = controller;

            const response = await fetch('/api/research/stream', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(errData.detail || 'Failed to initialize agent connection.');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop(); // Keep incomplete chunk in buffer

                for (const part of parts) {
                    if (!part.trim()) continue;

                    const lines = part.split('\n');
                    let eventType = '';
                    let dataStr = '';

                    for (const line of lines) {
                        if (line.startsWith('event:')) {
                            eventType = line.slice(6).trim();
                        } else if (line.startsWith('data:')) {
                            dataStr = line.slice(5).trim();
                        }
                    }

                    if (eventType && dataStr) {
                        try {
                            const data = JSON.parse(dataStr);
                            handleAgentEvent(eventType, data);
                        } catch (e) {
                            console.error('Error parsing SSE packet:', e, dataStr);
                        }
                    }
                }
            }

            // If completed loop
            if (currentRunData.status === 'running') {
                finalizeRun('completed', 'Research completed.');
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                finalizeRun('interrupted', 'Agent research run was interrupted by user.');
            } else {
                console.error('Stream failure:', err);
                appendTimelineItem('error', `Agent execution failed: ${err.message}`);
                finalizeRun('failed', `Run failed: ${err.message}`);
            }
        }
    }

    // Interrupt Run
    function interruptResearch() {
        if (activeStreamController) {
            activeStreamController.abort();
            activeStreamController = null;
        }
    }

    // Finalize states on run completion/failure
    function finalizeRun(status, message) {
        currentRunData.status = status;

        // Re-enable controls
        startResearchBtn.disabled = false;
        cancelResearchBtn.disabled = true;
        providerSelect.disabled = false;
        modelInput.disabled = false;
        apiKeyInput.disabled = false;
        queryInput.disabled = false;
        activeStreamController = null;

        // Reset indicators
        checkBackendHealth();

        if (status === 'completed') {
            showToast('Autonomous research compiled successfully!', 'success');
            // Save to history
            const finalResult = currentRunData.result;
            if (finalResult) {
                runHistory.unshift({
                    timestamp: new Date().toISOString(),
                    query: queryInput.value.trim(),
                    provider: providerSelect.value,
                    model: modelInput.value.trim() || defaultModels[providerSelect.value],
                    subquestions: currentRunData.subquestions,
                    notes: currentRunData.notes,
                    searches: currentRunData.searches,
                    searchQueries: currentRunData.searchQueries,
                    fetched: currentRunData.fetched,
                    fetchedUrls: currentRunData.fetchedUrls,
                    iterations: currentRunData.iterations,
                    thoughts: currentRunData.thoughts,
                    result: finalResult
                });
                saveHistory();
            }
        } else if (status === 'interrupted') {
            showToast(message, 'info');
            appendTimelineItem('status', 'Agent loop forcefully stopped.');
        } else {
            showToast(message, 'error');
        }
    }

    // Process Live Event Messages from Backend
    function handleAgentEvent(event, data) {
        console.log(`Event: ${event}`, data);

        switch (event) {
            case 'status':
                // Check if iteration reasoning
                if (data.includes('Iteration')) {
                    currentRunData.iterations++;
                    statIterations.textContent = currentRunData.iterations;
                }
                appendTimelineItem('status', data);
                break;

            case 'thought':
                currentRunData.thoughts.push(data);
                appendTimelineItem('thought', data);
                break;

            case 'sub_questions':
                currentRunData.subquestions = data;
                statSubquestions.textContent = data.length;
                renderSubquestionsSidebar(data);
                appendTimelineItem('status', `Query broken down into ${data.length} sub-questions.`);
                break;

            case 'search_query':
                currentRunData.searches++;
                currentRunData.searchQueries.push(data);
                statSearches.textContent = currentRunData.searches;
                appendTimelineItem('search', `Searching web for: "${data}"`);
                break;

            case 'search_results':
                // Sub-item render under searches
                appendSearchSnippet(data);
                break;

            case 'fetch_start':
                currentRunData.fetched++;
                currentRunData.fetchedUrls.push(data);
                statFetched.textContent = currentRunData.fetched;
                appendTimelineItem('fetch', `Reading source URL: ${data}`);
                break;

            case 'fetch_results':
                // Confirms character length
                appendFetchResults(data);
                break;

            case 'note_saved':
                currentRunData.notes.push(data);
                statNotes.textContent = currentRunData.notes.length;
                appendNoteCard(data);
                appendTimelineItem('note', `Saved Note Card: "${data.finding}"`);
                break;

            case 'final_result':
                currentRunData.result = data;
                renderFinalReport(data, queryInput.value.trim(), new Date());

                // Render and append the report directly to the timeline also
                const reportHtml = getReportHtml(data, queryInput.value.trim(), new Date());
                appendTimelineItem('report', reportHtml);

                appendTimelineItem('finish', 'Agent finalized research loop. synthesized report compiled.');
                switchTab('report-tab');
                break;

            case 'error':
                currentRunData.status = 'failed';
                appendTimelineItem('error', data);
                showToast(data, 'error');
                finalizeRun('failed', data);
                break;
        }
    }

    // UI Helpers: Reset stats counter
    function resetStats() {
        statSubquestions.textContent = '0';
        statSearches.textContent = '0';
        statFetched.textContent = '0';
        statNotes.textContent = '0';
        statIterations.textContent = '0';
    }

    // Append standard item to Timeline
    function appendTimelineItem(type, contentText) {
        const item = document.createElement('div');
        item.className = `timeline-item ${type}`;

        let iconClass = 'fa-solid fa-info';
        if (type === 'status') iconClass = 'fa-solid fa-compass-drafting';
        if (type === 'thought') iconClass = 'fa-solid fa-lightbulb';
        if (type === 'search') iconClass = 'fa-solid fa-magnifying-glass';
        if (type === 'fetch') iconClass = 'fa-solid fa-book-open-reader';
        if (type === 'note') iconClass = 'fa-solid fa-floppy-disk';
        if (type === 'finish') iconClass = 'fa-solid fa-circle-check';
        if (type === 'error') iconClass = 'fa-solid fa-triangle-exclamation';
        if (type === 'report') iconClass = 'fa-solid fa-file-invoice';

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        item.innerHTML = `
            <div class="timeline-node"><i class="${iconClass}"></i></div>
            <div class="timeline-meta">${capitalize(type)} &bull; ${timeStr}</div>
            <div class="timeline-content">${type === 'report' ? contentText : escapeHtml(contentText)}</div>
        `;

        timelineEvents.appendChild(item);

        // Auto scroll to bottom
        const tabEl = document.getElementById('timeline-tab');
        tabEl.scrollTop = tabEl.scrollHeight;
    }

    // Append search queries metadata details inside timeline
    function appendSearchSnippet(data) {
        const lastItem = timelineEvents.querySelector('.timeline-item.search:last-child');
        if (!lastItem) return;

        const results = data.results;
        if (!results || results.length === 0) {
            const errDiv = document.createElement('div');
            errDiv.style.color = 'var(--text-muted)';
            errDiv.style.marginTop = '0.5rem';
            errDiv.textContent = 'No search results found.';
            lastItem.querySelector('.timeline-content').appendChild(errDiv);
            return;
        }

        const snippetList = document.createElement('div');
        snippetList.style.marginTop = '0.6rem';
        snippetList.style.display = 'flex';
        snippetList.style.flexDirection = 'column';
        snippetList.style.gap = '0.4rem';

        results.slice(0, 3).forEach(res => {
            const row = document.createElement('div');
            row.style.fontSize = '0.8rem';
            row.style.borderLeft = '2px solid rgba(255, 255, 255, 0.1)';
            row.style.paddingLeft = '0.5rem';

            row.innerHTML = `
                <a href="${res.href}" target="_blank" style="color: var(--accent-teal); text-decoration: none; font-weight: 500;">
                    ${escapeHtml(res.title || 'Untitled Source')}
                </a>
                <div style="color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(res.body || '')}
                </div>
            `;
            snippetList.appendChild(row);
        });

        lastItem.querySelector('.timeline-content').appendChild(snippetList);
    }

    // Fetch progress timeline append
    function appendFetchResults(data) {
        const lastItem = timelineEvents.querySelector('.timeline-item.fetch:last-child');
        if (!lastItem) return;

        const okText = document.createElement('div');
        okText.style.fontSize = '0.78rem';
        okText.style.color = 'var(--status-green)';
        okText.style.marginTop = '0.3rem';
        okText.innerHTML = `<i class="fa-solid fa-circle-check"></i> Read completed successfully (${data.length} characters loaded).`;

        lastItem.querySelector('.timeline-content').appendChild(okText);
    }

    // Render Sub-questions sidebar
    function renderSubquestionsSidebar(questions) {
        if (!questions || questions.length === 0) {
            sidebarSubquestions.innerHTML = '<li class="empty-list">No sub-questions generated yet</li>';
            return;
        }

        sidebarSubquestions.innerHTML = '';
        questions.forEach(q => {
            const li = document.createElement('li');
            li.textContent = q;
            sidebarSubquestions.appendChild(li);
        });
    }

    // Append note card to grid
    function appendNoteCard(note) {
        // Clear placeholder if first note
        const placeholder = notesGrid.querySelector('.notes-placeholder');
        if (placeholder) {
            notesGrid.innerHTML = '';
        }

        const card = document.createElement('div');
        card.className = 'note-card';
        card.innerHTML = `
            <p>"${escapeHtml(note.finding)}"</p>
            <a href="${note.source_url}" target="_blank" class="note-source" title="${note.source_url}">
                <i class="fa-solid fa-link"></i> ${escapeHtml(note.source_url)}
            </a>
        `;
        notesGrid.appendChild(card);
    }

    // Render Database Tab fully
    function renderNotesTab(subquestions, notes) {
        renderSubquestionsSidebar(subquestions);

        if (!notes || notes.length === 0) {
            notesGrid.innerHTML = `
                <div class="notes-placeholder">
                    <i class="fa-solid fa-database"></i>
                    <p>No saved findings in database</p>
                </div>
            `;
            return;
        }

        notesGrid.innerHTML = '';
        notes.forEach(note => appendNoteCard(note));
    }

    // Render Synthesized Report Card
    function renderFinalReport(result, query, date) {
        if (!result) return;

        const dateStr = date.toLocaleString();

        reportContainer.innerHTML = `
            <div class="report-header-section animate-fade-in">
                <div class="report-header-title">
                    <h3>Synthesized Report</h3>
                    <span class="report-header-meta">
                        <i class="fa-solid fa-circle-question"></i> Query: "${escapeHtml(query)}" &bull; 
                        <i class="fa-solid fa-calendar"></i> Compiled: ${dateStr}
                    </span>
                </div>
                <button class="btn-primary" id="copy-report-btn" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
                    <i class="fa-solid fa-copy"></i> Copy Markdown
                </button>
            </div>
            
            <div class="report-markdown animate-fade-in">
                ${renderMarkdown(result.answer)}
            </div>
            
            ${result.confidence_gaps ? `
                <div class="confidence-gaps-box animate-fade-in">
                    <h4><i class="fa-solid fa-circle-exclamation"></i> Confidence Gaps / Uncertainties</h4>
                    <p>${escapeHtml(result.confidence_gaps)}</p>
                </div>
            ` : ''}

            <div class="report-sources animate-fade-in">
                <h4>Sources Used</h4>
                <div class="sources-list" id="report-sources-list">
                    <!-- Links populated here -->
                </div>
            </div>
        `;

        // Render sources
        const sourcesList = document.getElementById('report-sources-list');
        if (result.sources && result.sources.length > 0) {
            result.sources.forEach(src => {
                const card = document.createElement('a');
                card.href = src;
                card.target = '_blank';
                card.className = 'source-link-card';
                card.innerHTML = `
                    <i class="fa-solid fa-globe"></i>
                    <span class="source-url-text" title="${src}">${escapeHtml(src)}</span>
                `;
                sourcesList.appendChild(card);
            });
        } else {
            sourcesList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">No sources recorded.</div>';
        }

        // Copy button handler
        document.getElementById('copy-report-btn').addEventListener('click', () => {
            const textToCopy = `Query: ${query}\nDate: ${dateStr}\n\n${result.answer}\n\nSources:\n${result.sources?.join('\n') || 'None'}`;
            navigator.clipboard.writeText(textToCopy)
                .then(() => showToast('Report copied to clipboard!', 'success'))
                .catch(() => showToast('Failed to copy text.', 'error'));
        });
    }

    // Generate Report HTML content for rendering inside the timeline or elsewhere
    function getReportHtml(result, query, date) {
        if (!result) return '';
        const dateStr = date.toLocaleString();

        // Render sources HTML
        let sourcesHtml = '';
        if (result.sources && result.sources.length > 0) {
            result.sources.forEach(src => {
                sourcesHtml += `
                    <a href="${src}" target="_blank" class="source-link-card">
                        <i class="fa-solid fa-globe"></i>
                        <span class="source-url-text" title="${src}">${escapeHtml(src)}</span>
                    </a>
                `;
            });
        } else {
            sourcesHtml = '<div style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">No sources recorded.</div>';
        }

        const textToCopy = `Query: ${query}\nDate: ${dateStr}\n\n${result.answer}\n\nSources:\n${result.sources?.join('\n') || 'None'}`;
        const escapedTextToCopy = escapeHtml(textToCopy);

        return `
            <div class="report-header-section" style="margin-bottom: 1rem;">
                <div class="report-header-title">
                    <h3 style="font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem;"><i class="fa-solid fa-file-invoice" style="color: var(--accent-teal);"></i> Synthesized Report</h3>
                    <span class="report-header-meta">
                        Query: "${escapeHtml(query)}" &bull; Compiled: ${dateStr}
                    </span>
                </div>
                <button class="btn-primary timeline-copy-report-btn" data-report-text="${escapedTextToCopy}" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">
                    <i class="fa-solid fa-copy"></i> Copy Markdown
                </button>
            </div>
            
            <div class="report-markdown">
                ${renderMarkdown(result.answer)}
            </div>
            
            ${result.confidence_gaps ? `
                <div class="confidence-gaps-box">
                    <h4><i class="fa-solid fa-circle-exclamation"></i> Confidence Gaps / Uncertainties</h4>
                    <p>${escapeHtml(result.confidence_gaps)}</p>
                </div>
            ` : ''}

            <div class="report-sources">
                <h4>Sources Used</h4>
                <div class="sources-list">
                    ${sourcesHtml}
                </div>
            </div>
        `;
    }

    // Markdown Parser (Regex)
    function renderMarkdown(md) {
        if (!md) return '';
        let html = md;

        // Escape standard HTML first to prevent injection
        html = escapeHtml(html);

        // Parse titles
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // Parse bold
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Parse italic
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // Parse blockquote
        html = html.replace(/^\&gt\; (.*$)/gim, '<blockquote>$1</blockquote>');

        // Parse code blocks
        html = html.replace(/\`\`\`([\s\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
        html = html.replace(/\`(.*?)\`/g, '<code>$1</code>');

        // Parse lists (unordered)
        html = html.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');
        // Wrap adjacent li tags in ul
        html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
        html = html.replace(/<\/ul>\s*<ul>/g, ''); // Join lists

        // Parse numbered lists
        html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gim, '<ol>$1</ol>');
        html = html.replace(/<\/ol>\s*<ol>/g, ''); // Join lists

        // Replace clean hyperlinks (reverse html escaping for links in anchor attributes)
        html = html.replace(/\[(.*?)\]\((.*?)\)/g, (match, text, url) => {
            const cleanUrl = url.replace(/&amp;/g, '&');
            return `<a href="${cleanUrl}" target="_blank" style="color: var(--accent-teal); text-decoration: none; font-weight: 500;">${text}</a>`;
        });

        // Split and restore paragraphs
        const lines = html.split('\n\n');
        html = lines.map(p => {
            const trimmed = p.trim();
            if (!trimmed) return '';
            if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<ol') || trimmed.startsWith('<pre') || trimmed.startsWith('<blockquote')) {
                return trimmed;
            }
            return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
        }).join('');

        return html;
    }

    // Toast Notifications
    function showToast(message, type = 'info') {
        toastMessage.textContent = message;
        toast.className = `toast show ${type}`;

        let iconClass = 'fa-solid fa-info-circle';
        if (type === 'success') iconClass = 'fa-solid fa-circle-check';
        if (type === 'error') iconClass = 'fa-solid fa-triangle-exclamation';

        toast.querySelector('.toast-icon').className = `toast-icon ${iconClass}`;

        // Auto dismiss after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3500);
    }

    // Utility Helpers
    function escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function (m) { return map[m]; });
    }

    function capitalize(string) {
        if (!string) return '';
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    function saveSettings() {
        try {
            localStorage.setItem('research_provider', providerSelect.value);
            localStorage.setItem('research_model', modelInput.value.trim());
            localStorage.setItem('research_api_key', apiKeyInput.value.trim());
        } catch (e) {
            console.error('Failed to save settings:', e);
        }
    }

    function loadSettings() {
        try {
            const prov = localStorage.getItem('research_provider');
            const model = localStorage.getItem('research_model');
            const key = localStorage.getItem('research_api_key');

            if (prov) providerSelect.value = prov;
            if (model) modelInput.value = model;
            if (key) apiKeyInput.value = key;
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    function showStatsModal(title, contentHtml) {
        let modal = document.getElementById('stats-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'stats-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-container glassmorphism">
                    <div class="modal-header">
                        <h3 id="modal-title"></h3>
                        <button class="btn-icon" id="close-modal-btn" title="Close Modal">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="modal-body" id="modal-body-content"></div>
                </div>
            `;
            document.body.appendChild(modal);

            // Close listeners
            modal.querySelector('#close-modal-btn').addEventListener('click', () => {
                modal.classList.remove('show');
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('show');
                }
            });

            // ESC key to close
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal.classList.contains('show')) {
                    modal.classList.remove('show');
                }
            });
        }

        modal.querySelector('#modal-title').textContent = title;
        modal.querySelector('#modal-body-content').innerHTML = contentHtml;
        modal.classList.add('show');
    }

    // Interactive Physics-based Micro-Animations Engine
    function initAnimations() {
        // 1. 3D Tilt Effect on cards (.glassmorphism, .stat-card, .note-card)
        document.addEventListener('mousemove', (e) => {
            const card = e.target.closest('.glassmorphism, .stat-card, .note-card');

            // Clean up any cards that are no longer targeted
            document.querySelectorAll('.tilt-active').forEach(activeCard => {
                if (activeCard !== card) {
                    activeCard.classList.remove('tilt-active');
                    activeCard.style.transform = '';
                }
            });

            if (!card) return;

            card.classList.add('tilt-active');

            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            const percentX = (x - centerX) / centerX;
            const percentY = (y - centerY) / centerY;

            const maxTilt = 6; // Subtle aesthetic angle
            const tiltX = percentY * maxTilt;
            const tiltY = -percentX * maxTilt;

            card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.015, 1.015, 1.015)`;
        });

        document.addEventListener('mouseleave', () => {
            document.querySelectorAll('.tilt-active').forEach(activeCard => {
                activeCard.classList.remove('tilt-active');
                activeCard.style.transform = '';
            });
        });

        // Touch support for 3D tilt
        document.addEventListener('touchmove', (e) => {
            if (e.touches.length === 0) return;
            const touch = e.touches[0];
            const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
            const card = targetEl ? targetEl.closest('.glassmorphism, .stat-card, .note-card') : null;

            document.querySelectorAll('.tilt-active').forEach(activeCard => {
                if (activeCard !== card) {
                    activeCard.classList.remove('tilt-active');
                    activeCard.style.transform = '';
                }
            });

            if (!card) return;

            card.classList.add('tilt-active');

            const rect = card.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            const percentX = (x - centerX) / centerX;
            const percentY = (y - centerY) / centerY;

            const maxTilt = 6;
            const tiltX = percentY * maxTilt;
            const tiltY = -percentX * maxTilt;

            card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.015, 1.015, 1.015)`;
        }, { passive: true });

        document.addEventListener('touchend', () => {
            document.querySelectorAll('.tilt-active').forEach(activeCard => {
                activeCard.classList.remove('tilt-active');
                activeCard.style.transform = '';
            });
        });

        // 2. Ripple effect on buttons (.btn-primary, .btn-danger) on click
        document.addEventListener('mousedown', (e) => {
            const btn = e.target.closest('.btn-primary, .btn-danger');
            if (!btn) return;

            const ripple = document.createElement('span');
            ripple.className = 'click-ripple';

            const rect = btn.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;

            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;

            btn.appendChild(ripple);

            ripple.addEventListener('animationend', () => {
                ripple.remove();
            });
        });

        // 3. Timeline Items connecting line sibling glow on hover
        document.addEventListener('mouseover', (e) => {
            const item = e.target.closest('.timeline-item');
            if (!item) return;

            item.classList.add('item-hovered');

            const prevItem = item.previousElementSibling;
            if (prevItem && prevItem.classList.contains('timeline-item')) {
                prevItem.classList.add('line-glow-down');
            }
        });

        document.addEventListener('mouseout', (e) => {
            const item = e.target.closest('.timeline-item');
            if (!item) return;

            item.classList.remove('item-hovered');

            const prevItem = item.previousElementSibling;
            if (prevItem && prevItem.classList.contains('timeline-item')) {
                prevItem.classList.remove('line-glow-down');
            }
        });

        // 6. Particle / spark emission on hover/mousemove over note cards and subquestions
        let lastSparkTime = 0;
        const sparkThrottle = 70; // ms between spark spawns

        document.addEventListener('mousemove', (e) => {
            const emitter = e.target.closest('.subquestions-list li:not(.empty-list), .note-card');
            if (!emitter) return;

            const now = Date.now();
            if (now - lastSparkTime < sparkThrottle) return;
            lastSparkTime = now;

            const spark = document.createElement('span');
            spark.className = 'spark';

            const x = e.pageX;
            const y = e.pageY;

            const size = Math.random() * 5 + 3; // 3px to 8px
            const destX = (Math.random() - 0.5) * 50; // Random offset x
            const destY = (Math.random() - 0.8) * 60 - 15; // Random offset y (tending upwards)

            spark.style.width = `${size}px`;
            spark.style.height = `${size}px`;
            spark.style.left = `${x}px`;
            spark.style.top = `${y}px`;

            const isTeal = Math.random() > 0.5;
            spark.style.background = isTeal ? 'var(--accent-teal)' : 'var(--accent-purple)';
            spark.style.boxShadow = isTeal ? '0 0 6px var(--accent-teal)' : '0 0 6px var(--accent-purple)';

            document.body.appendChild(spark);

            requestAnimationFrame(() => {
                spark.style.transform = `translate(${destX}px, ${destY}px) scale(0)`;
                spark.style.opacity = '0';
            });

            spark.addEventListener('transitionend', () => {
                spark.remove();
            });
        });
    }
});
