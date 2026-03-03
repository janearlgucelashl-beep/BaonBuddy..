import { Store } from './store.js';

// --- State & Constants ---
let state = null;
let currentPlanId = null;
let globalChart = null;
let planChart = null;
let planHistoryChart = null;

// --- Helper Functions ---
function formatCurrency(val) {
    const symbol = state?.settings?.currency || '₱';
    return `${symbol}${parseFloat(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function refreshPlanTarget(plan) {
    if (!plan.dayActive) return;
    if (!plan.manualSavingsMode) {
        plan.dailySavingsGoal = calculateRequiredDaily(plan, plan.dailyAllowance);
    }
}

function getCurrentLogicalDate() {
    const { timezone, resetTime } = state.settings;
    const now = new Date();
    // Use Intl to get the current date/time in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const d = {};
    parts.forEach(p => d[p.type] = p.value);
    
    // Construct a Date object for the "wall time" in that timezone
    const currentH = parseInt(d.hour);
    const currentM = parseInt(d.minute);
    const [resetH, resetM] = resetTime.split(':').map(Number);
    
    // YYYY-MM-DD
    const isoStr = `${d.year}-${d.month}-${d.day}`;
    let logicalDate = new Date(isoStr + 'T00:00:00');
    
    // If current wall time is before the reset time, it's still "yesterday" logically
    if (currentH < resetH || (currentH === resetH && currentM < resetM)) {
        logicalDate.setDate(logicalDate.getDate() - 1);
    }
    
    return logicalDate.toLocaleDateString('en-CA');
}

function getSettingsDate() {
    // Returns a Date object for the START of the current logical day
    const str = getCurrentLogicalDate();
    return new Date(str + 'T00:00:00');
}

function mergeExclusions(exclusions) {
    if (!exclusions || exclusions.length === 0) return [];
    
    // Sort by start date
    const sorted = [...exclusions].sort((a, b) => a.start.localeCompare(b.start));
    const merged = [];
    
    let current = sorted[0];
    
    for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i];
        // If overlap or contiguous (next start <= current end)
        if (next.start <= current.end) {
            // Merge: take the max end date
            if (next.end > current.end) {
                current.end = next.end;
            }
        } else {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);
    return merged;
}

function isDateInExclusions(date, exclusions) {
    const dStr = date.toLocaleDateString('en-CA');
    return exclusions.some(ex => dStr >= ex.start && dStr <= ex.end);
}

function countCalculationDays(start, end, exclusions = []) {
    // Counts only Monday to Friday (Mon-Fri)
    // AND skips exclusion periods
    let count = 0;
    // Ensure we work with clear midnight dates
    let cur = new Date(start);
    if (typeof start === 'string') cur = new Date(start + 'T00:00:00');
    
    let last = new Date(end);
    if (typeof end === 'string') last = new Date(end + 'T00:00:00');
    
    cur.setHours(0, 0, 0, 0);
    last.setHours(0, 0, 0, 0);

    const mergedEx = mergeExclusions(exclusions);

    while (cur <= last) {
        const dayNum = cur.getDay(); // 0 is Sun, 6 is Sat
        const isWeekend = (dayNum === 0 || dayNum === 6);
        
        // Format cur to YYYY-MM-DD for exclusion check
        const dStr = cur.toLocaleDateString('en-CA');
        const isExcluded = mergedEx.some(ex => dStr >= ex.start && dStr <= ex.end);
        
        if (!isWeekend && !isExcluded) {
            count++;
        }
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

function calculateRequiredDaily(plan, allowance) {
    const today = getSettingsDate();

    if (isDateInExclusions(today, plan.exclusions || [])) {
        return 0;
    }

    if (plan.useEndDate === false) {
        if (!plan.manualSavingsMode) {
            return allowance * 0.5;
        }
        return plan.dailySavingsGoal || 0;
    }

    if (!plan.goal) return 0;

    const end = new Date(plan.endDate + 'T00:00:00');
    
    if (today > end) return 0;
    
    const daysLeft = countCalculationDays(today, end, plan.exclusions || []);
    if (daysLeft <= 0) return allowance;
    
    const A = Math.max(0, plan.goal - (plan.totalSaved || 0));
    const D = daysLeft;
    
    const Q = Math.floor(A / D);
    const R = A % D;

    const possibleTargets = [];
    if (D - R > 0) possibleTargets.push(Q);
    if (R > 0) possibleTargets.push(Q + 1);
    
    let target = possibleTargets.length > 0 ? Math.min(...possibleTargets) : 0;

    if (plan.useEndDate !== false && !plan.manualSavingsMode && allowance >= 80 && target < 50) {
        const basePercent = 20;
        const drop = 49 - Math.floor(target);
        const totalPercent = basePercent + Math.max(0, drop);
        target += (allowance * (totalPercent / 100));
    }
    
    return Math.min(allowance, target);
}

function calculateProjectedEndDate(plan) {
    if (!plan.goal || !plan.dailySavingsGoal || plan.dailySavingsGoal <= 0) return null;
    
    const remainingNeeded = plan.goal - (plan.totalSaved || 0);
    if (remainingNeeded <= 0) return "Goal Met!";
    
    const daysNeeded = Math.ceil(remainingNeeded / plan.dailySavingsGoal);
    
    let cur = getSettingsDate();
    // Start counting from tomorrow
    cur.setDate(cur.getDate() + 1);
    
    let workingDaysFound = 0;
    const mergedEx = mergeExclusions(plan.exclusions || []);

    // Safety counter to prevent infinite loops
    let safety = 0;
    while (workingDaysFound < daysNeeded && safety < 10000) {
        safety++;
        const dayNum = cur.getDay();
        const isWeekend = (dayNum === 0 || dayNum === 6);
        const dStr = cur.toLocaleDateString('en-CA');
        const isExcluded = mergedEx.some(ex => dStr >= ex.start && dStr <= ex.end);
        
        if (!isWeekend && !isExcluded) {
            workingDaysFound++;
        }
        
        if (workingDaysFound < daysNeeded) {
            cur.setDate(cur.getDate() + 1);
        }
    }
    
    return cur.toLocaleDateString('en-CA');
}

function saveState() {
    Store.save(state);
}

// --- Daily Logic ---
function checkDailyReset() {
    const todayStr = getCurrentLogicalDate();
    if (state.lastLoginDate !== todayStr) {
        state.plans.forEach(plan => {
            if (plan.dayActive) {
                // Actual savings for the day is whatever was left from the allowance
                const actualSavings = (plan.dailyAllowance || 0) - (plan.dailySpent || 0);
                const target = plan.dailySavingsGoal || 0;
                
                // Track debt in penalty mode if actual savings didn't meet the target
                if (plan.penaltyMode && (plan.estimateMode || plan.manualSavingsMode)) {
                    if (actualSavings < target) {
                        plan.penaltyDebt = (plan.penaltyDebt || 0) + (target - actualSavings);
                    }
                }

                // Update totals (actualSavings can be negative if overspent)
                state.totalSavings += actualSavings;
                plan.totalSaved = (plan.totalSaved || 0) + actualSavings;
                plan.totalSpent = (plan.totalSpent || 0) + (plan.dailySpent || 0);

                // Plan-specific history tracking
                plan.history = plan.history || [];
                plan.history.push({
                    date: state.lastLoginDate || todayStr,
                    totalSaved: plan.totalSaved
                });
                if (plan.history.length > 30) plan.history.shift();
                
                // Reset daily
                plan.dayActive = false;
                plan.dailyAllowance = 0;
                plan.dailySpent = 0;
                plan.dailySavingsGoal = 0;
            }
        });

        state.history.push({
            date: state.lastLoginDate || todayStr,
            savings: state.totalSavings
        });
        if (state.history.length > 30) state.history.shift();

        state.lastLoginDate = todayStr;
        saveState();
    }
}

// --- Navigation ---
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    document.getElementById(screenId).classList.add('active');
    const navItem = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
    if (navItem) navItem.classList.add('active');

    checkDailyReset(); // Ensure reset whenever switching views
    if (screenId === 'home-screen') renderPlans();
    if (screenId === 'reports-screen') renderGlobalReports();
}

function openPlanHub(planId) {
    currentPlanId = planId;
    const plan = state.plans.find(p => p.id === planId);
    document.getElementById('detail-plan-name').innerText = plan.name;
    
    // Set settings UI values
    document.getElementById('toggle-estimate').checked = !!plan.estimateMode;
    document.getElementById('toggle-manual').checked = !!plan.manualSavingsMode;
    document.getElementById('toggle-penalty').checked = !!plan.penaltyMode;
    document.getElementById('toggle-use-end-date').checked = plan.useEndDate !== false;
    document.getElementById('edit-plan-name').value = plan.name;
    document.getElementById('edit-start-date').value = plan.startDate;
    document.getElementById('edit-end-date').value = plan.endDate || '';
    document.getElementById('edit-end-date-group').classList.toggle('hidden', plan.useEndDate === false);
    document.getElementById('edit-goal').value = plan.goal || '';

    renderExclusions();
    updatePlanHubUI();
    showScreen('plan-detail-screen');
    // Default to 'This' tab
    switchTab('this-tab');
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
    
    if (tabId === 'reports-tab') renderPlanReports();
}

// --- Rendering ---
function renderPlans() {
    const list = document.getElementById('plans-list');
    if (state.plans.length === 0) {
        list.innerHTML = `
            <div class="card" style="text-align:center; border-style: dashed; padding: 40px 20px;">
                <i data-lucide="sparkles" size="32" style="color:var(--secondary-dark); margin-bottom:10px"></i>
                <p style="color:var(--text-light); font-weight:600">No savings plans yet!<br>Tap the plus button to start your journey.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    const today = getSettingsDate();

    list.innerHTML = state.plans.map(p => {
        const startDate = new Date(p.startDate + 'T00:00:00');
        const isPending = today < startDate;
        const progress = p.goal ? Math.min(100, ((p.totalSaved || 0) / p.goal) * 100) : 0;
        
        return `
            <div class="plan-card ${isPending ? 'pending' : ''}" onclick="window.openPlanHub('${p.id}')">
                <div style="flex:1">
                    <h3>${p.name}</h3>
                    <p>${isPending ? 'Starts ' + p.startDate : 'Target: ' + p.endDate}</p>
                    <div style="margin-top:8px; font-weight:800; color:var(--primary-dark)">${formatCurrency(p.totalSaved || 0)} <span style="font-weight:400; font-size:11px; color:var(--text-light)">SAVED</span></div>
                </div>
                <div style="text-align:right">
                    <div style="background:var(--secondary); width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-left:auto; margin-bottom:5px; box-shadow:0 4px 8px rgba(251, 192, 45, 0.3)">
                        <i data-lucide="chevron-right" style="color:var(--text)"></i>
                    </div>
                    ${p.goal ? `<div style="font-size:12px; font-weight:800; color:var(--primary)">${progress.toFixed(0)}%</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
    lucide.createIcons();
}

function updatePlanHubUI() {
    const plan = state.plans.find(p => p.id === currentPlanId);
    const today = new Date();
    const startDate = new Date(plan.startDate);
    const isStarted = today >= startDate;

    // "This" tab state
    const banner = document.getElementById('not-started-msg');
    const actionCard = document.getElementById('daily-action-card');
    
    if (!isStarted) {
        banner.classList.remove('hidden');
        document.getElementById('start-date-status').innerText = `Plan starts on ${plan.startDate}`;
        actionCard.classList.add('hidden');
    } else {
        banner.classList.add('hidden');
        actionCard.classList.remove('hidden');
        
        if (plan.dayActive) {
            document.getElementById('allowance-setup-ui').classList.add('hidden');
            document.getElementById('day-active-ui').classList.remove('hidden');
            
            const manualEditBtn = document.getElementById('edit-manual-savings-btn');
            manualEditBtn.classList.toggle('hidden', !plan.manualSavingsMode);

            const remaining = plan.dailyAllowance - plan.dailySpent;
            const target = plan.dailySavingsGoal || 0;
            
            document.getElementById('ui-remaining').innerText = formatCurrency(remaining);
            document.getElementById('ui-savings').innerText = formatCurrency(target);
            document.getElementById('ui-spent').innerText = formatCurrency(plan.dailySpent || 0);
        } else {
            document.getElementById('allowance-setup-ui').classList.remove('hidden');
            document.getElementById('day-active-ui').classList.add('hidden');
            document.getElementById('manual-savings-group').classList.toggle('hidden', !plan.manualSavingsMode);
            // Clear inputs for new day
            document.getElementById('input-allowance').value = '';
            document.getElementById('input-manual-savings').value = '';
        }
    }

    renderProducts();
}

function renderExclusions() {
    const plan = state.plans.find(p => p.id === currentPlanId);
    const container = document.getElementById('exclusions-list');
    
    if (!plan.exclusions || plan.exclusions.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-light); font-size: 11px; margin: 10px 0;">No exclusions set.</p>`;
        return;
    }

    // Merge for display so the user sees the logic applied
    const merged = mergeExclusions(plan.exclusions);
    // Update the actual state to keep it clean (sync with merged)
    plan.exclusions = merged;

    container.innerHTML = plan.exclusions.map((ex, idx) => `
        <div class="exclusion-item">
            <div class="excl-dates">
                <span>${ex.start}</span>
                <i data-lucide="arrow-right" size="12"></i>
                <span>${ex.end}</span>
            </div>
            <button class="btn-del-excl" onclick="window.deleteExclusion(${idx})"><i data-lucide="trash-2" size="14"></i></button>
        </div>
    `).join('');
    lucide.createIcons();
}

function renderProducts() {
    const plan = state.plans.find(p => p.id === currentPlanId);
    const container = document.getElementById('products-grid');
    
    if (!plan.products || plan.products.length === 0) {
        container.innerHTML = `<p style="grid-column: 1/-1; text-align:center; color:var(--text-light)">No products.</p>`;
        return;
    }

    container.innerHTML = plan.products.map((prod, idx) => `
        <div class="product-item">
            <button class="btn-del-prod btn-icon" onclick="window.deleteProduct(${idx})"><i data-lucide="x" size="12"></i></button>
            <h4>${prod.name}</h4>
            <p>${formatCurrency(prod.price)}</p>
            <button class="btn-buy-mini" onclick="window.buyProduct(${idx})" ${!plan.dayActive ? 'disabled' : ''}>Buy</button>
        </div>
    `).join('');
    lucide.createIcons();
}

function renderPlanReports() {
    const plan = state.plans.find(p => p.id === currentPlanId);
    const progress = plan.goal ? Math.min(100, ((plan.totalSaved || 0) / plan.goal) * 100) : 0;
    
    document.getElementById('plan-progress-bar').style.width = `${progress}%`;
    
    const isIndefinite = plan.useEndDate === false;
    document.getElementById('stat-days-left-group').classList.toggle('hidden', isIndefinite);
    document.getElementById('stat-projected-group').classList.toggle('hidden', !isIndefinite);

    if (!isIndefinite) {
        const today = getSettingsDate();
        const workingDaysLeft = countCalculationDays(today, plan.endDate, plan.exclusions || []);
        document.getElementById('stat-days-left').innerText = workingDaysLeft;
    } else {
        const projected = calculateProjectedEndDate(plan);
        document.getElementById('stat-projected-date').innerText = projected || 'TBD';
    }

    document.getElementById('stat-debt').innerText = formatCurrency(plan.penaltyDebt || 0);
    
    const savedEl = document.getElementById('stat-total-saved') || null;
    if (savedEl) savedEl.innerText = formatCurrency(plan.totalSaved || 0);

    if (plan.dayActive) {
        const rec = plan.dailySavingsGoal || 0;
        document.getElementById('plan-recommendation').innerText = `Today's Target: ${formatCurrency(rec)}`;
    } else {
        document.getElementById('plan-recommendation').innerText = "Set today's allowance to see target.";
    }

    const ctx = document.getElementById('plan-mini-chart');
    if (planChart) planChart.destroy();
    planChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Saved', 'Remaining'],
            datasets: [{
                data: [plan.totalSaved || 0, Math.max(0, (plan.goal || 0) - (plan.totalSaved || 0))],
                backgroundColor: ['#2ecc71', '#eee']
            }]
        },
        options: { cutout: '70%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, maintainAspectRatio: false }
    });

    const ctxHistory = document.getElementById('plan-history-chart');
    if (planHistoryChart) planHistoryChart.destroy();

    const hist = plan.history || [];
    const labels = hist.map(h => h.date.split(' ').slice(1,3).join(' '));
    const data = hist.map(h => h.totalSaved);

    if (labels.length === 0) { 
        labels.push('Now'); 
        data.push(plan.totalSaved || 0); 
    }

    planHistoryChart = new Chart(ctxHistory, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data,
                borderColor: '#00bcd4',
                tension: 0.4,
                pointRadius: 0,
                fill: false,
                borderWidth: 2
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: false } },
            maintainAspectRatio: false
        }
    });
}

function renderGlobalReports() {
    document.getElementById('total-savings-amount').innerText = formatCurrency(state.totalSavings);
    
    const ctx = document.getElementById('savings-chart');
    if (globalChart) globalChart.destroy();
    
    const labels = state.history.map(h => h.date.split(' ').slice(1,3).join(' '));
    const data = state.history.map(h => h.savings);
    
    if (labels.length === 0) { labels.push('Today'); data.push(state.totalSavings); }

    globalChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Savings Trend',
                data,
                borderColor: '#2ecc71',
                tension: 0.3,
                fill: true,
                backgroundColor: 'rgba(46, 204, 113, 0.1)'
            }]
        },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });

    const list = document.getElementById('global-reports-list');
    list.innerHTML = state.plans.map(p => `
        <div class="card">
            <div style="display:flex; justify-content:space-between">
                <strong>${p.name}</strong>
                <span>${formatCurrency(p.totalSaved || 0)}</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${p.goal ? (p.totalSaved / p.goal * 100) : 0}%"></div>
            </div>
        </div>
    `).join('');
}

// --- Event Handlers ---
function setupEvents() {
    document.getElementById('agree-tos-btn').onclick = () => {
        state.tosAgreed = true;
        saveState();
        document.getElementById('tos-overlay').classList.add('hidden');
        document.getElementById('main-content').classList.remove('hidden');
    };

    document.querySelectorAll('.nav-item').forEach(b => {
        b.onclick = () => {
            if (b.dataset.screen === 'home-screen' || b.dataset.screen === 'reports-screen') {
                document.getElementById('settings-global-screen').classList.remove('active');
            }
            showScreen(b.dataset.screen);
        }
    });

    document.querySelectorAll('.tab-btn').forEach(b => {
        b.onclick = () => switchTab(b.dataset.tab);
    });

    document.getElementById('back-to-home').onclick = () => showScreen('home-screen');

    // Global Settings
    document.getElementById('open-settings-btn').onclick = () => {
        document.getElementById('set-currency').value = state.settings.currency;
        document.getElementById('set-timezone').value = state.settings.timezone;
        document.getElementById('set-reset-time').value = state.settings.resetTime;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('settings-global-screen').classList.add('active');
    };
    document.getElementById('back-from-settings').onclick = () => {
        document.getElementById('settings-global-screen').classList.remove('active');
        showScreen('home-screen');
    };
    document.getElementById('save-settings-btn').onclick = () => {
        state.settings.currency = document.getElementById('set-currency').value || '₱';
        state.settings.timezone = document.getElementById('set-timezone').value;
        state.settings.resetTime = document.getElementById('set-reset-time').value;
        state.plans.forEach(refreshPlanTarget);
        saveState();
        alert('Settings Saved!');
        document.getElementById('settings-global-screen').classList.remove('active');
        showScreen('home-screen');
    };
    document.getElementById('reset-settings-btn').onclick = () => {
        if (!confirm('Reset settings to default?')) return;
        state.settings = {
            currency: '₱',
            timezone: 'Asia/Manila',
            resetTime: '00:00'
        };
        saveState();
        alert('Settings Reset!');
        document.getElementById('settings-global-screen').classList.remove('active');
        showScreen('home-screen');
    };

    // Create Plan
    document.getElementById('add-plan-btn').onclick = () => {
        document.getElementById('plan-modal').classList.remove('hidden');
    };
    document.getElementById('new-plan-use-end').onchange = (e) => {
        document.getElementById('new-plan-end-group').classList.toggle('hidden', !e.target.checked);
    };
    document.getElementById('close-plan-modal').onclick = () => {
        document.getElementById('plan-modal').classList.add('hidden');
    };
    document.getElementById('save-new-plan').onclick = () => {
        const name = document.getElementById('new-plan-name').value;
        const start = document.getElementById('new-plan-start').value;
        const useEnd = document.getElementById('new-plan-use-end').checked;
        const end = useEnd ? document.getElementById('new-plan-end').value : null;
        const goalInput = document.getElementById('new-plan-goal').value;
        const goal = goalInput ? Math.floor(parseFloat(goalInput)) : 0;

        if (!name || !start || (useEnd && !end)) return alert('Name and required Dates are missing');

        const newPlan = {
            id: Date.now().toString(),
            name, startDate: start, endDate: end, 
            useEndDate: useEnd,
            goal: goal,
            products: [], totalSaved: 0, totalSpent: 0, penaltyDebt: 0,
            estimateMode: true, manualSavingsMode: false, penaltyMode: true,
            dayActive: false, history: []
        };
        state.plans.push(newPlan);
        saveState();
        renderPlans();
        document.getElementById('plan-modal').classList.add('hidden');
    };

    // Update Plan
    document.getElementById('update-plan-btn').onclick = () => {
        const plan = state.plans.find(p => p.id === currentPlanId);
        plan.name = document.getElementById('edit-plan-name').value;
        plan.startDate = document.getElementById('edit-start-date').value;
        plan.useEndDate = document.getElementById('toggle-use-end-date').checked;
        plan.endDate = plan.useEndDate ? document.getElementById('edit-end-date').value : null;
        const goalInput = document.getElementById('edit-goal').value;
        plan.goal = goalInput ? Math.floor(parseFloat(goalInput)) : 0;
        
        refreshPlanTarget(plan);
        saveState();
        updatePlanHubUI();
        alert('Plan updated');
    };

    // Toggles
    document.getElementById('toggle-estimate').onchange = (e) => {
        if (e.target.checked) {
            if (navigator.vibrate) navigator.vibrate(10);
        }
        const plan = state.plans.find(p => p.id === currentPlanId);
        plan.estimateMode = e.target.checked;
        if (plan.estimateMode) {
            plan.manualSavingsMode = false;
            document.getElementById('toggle-manual').checked = false;
        }
        refreshPlanTarget(plan);
        saveState();
        updatePlanHubUI();
    };
    document.getElementById('toggle-manual').onchange = (e) => {
        const plan = state.plans.find(p => p.id === currentPlanId);
        plan.manualSavingsMode = e.target.checked;
        if (plan.manualSavingsMode) {
            plan.estimateMode = false;
            document.getElementById('toggle-estimate').checked = false;
        } else {
            plan.estimateMode = true;
            document.getElementById('toggle-estimate').checked = true;
        }
        refreshPlanTarget(plan);
        saveState();
        updatePlanHubUI();
    };
    document.getElementById('toggle-penalty').onchange = (e) => {
        const plan = state.plans.find(p => p.id === currentPlanId);
        plan.penaltyMode = e.target.checked;
        saveState();
    };

    document.getElementById('toggle-use-end-date').onchange = (e) => {
        const plan = state.plans.find(p => p.id === currentPlanId);
        plan.useEndDate = e.target.checked;
        document.getElementById('edit-end-date-group').classList.toggle('hidden', !plan.useEndDate);
        refreshPlanTarget(plan);
        saveState();
        updatePlanHubUI();
    };

    // Daily Actions
    document.getElementById('start-day-btn').onclick = () => {
        const plan = state.plans.find(p => p.id === currentPlanId);
        const allowanceInput = document.getElementById('input-allowance').value;
        if (allowanceInput === "") return alert('Please enter today\'s allowance');
        
        const allowance = parseFloat(allowanceInput) || 0;
        let target = 0;

        if (plan.manualSavingsMode) {
            target = parseFloat(document.getElementById('input-manual-savings').value) || 0;
        } else if (plan.estimateMode) {
            // Formula updated: includes goal, total savings, and days remaining (M-F)
            target = calculateRequiredDaily(plan, allowance);
        }

        plan.dayActive = true;
        plan.dailyAllowance = allowance;
        plan.dailySavingsGoal = target;
        plan.dailySpent = 0;
        saveState();
        updatePlanHubUI();
    };

    document.getElementById('edit-allowance-btn').onclick = () => {
        const plan = state.plans.find(p => p.id === currentPlanId);
        if (!confirm('Are you sure you want to edit today\'s allowance? Existing spending will be retained.')) return;

        const newVal = prompt("Enter your new total allowance for today:", plan.dailyAllowance);
        if (newVal === null || newVal === "" || isNaN(parseFloat(newVal))) return;

        plan.dailyAllowance = parseFloat(newVal);
        refreshPlanTarget(plan);
        
        saveState();
        updatePlanHubUI();
    };

    document.getElementById('edit-manual-savings-btn').onclick = () => {
        const plan = state.plans.find(p => p.id === currentPlanId);
        if (!confirm('Are you sure you want to change today\'s manual savings target?')) return;

        const newVal = prompt("Enter your new manual savings target for today:", plan.dailySavingsGoal);
        if (newVal === null || newVal === "" || isNaN(parseFloat(newVal))) return;

        plan.dailySavingsGoal = parseFloat(newVal);
        
        saveState();
        updatePlanHubUI();
    };

    document.getElementById('buy-other-btn').onclick = () => {
        const plan = state.plans.find(p => p.id === currentPlanId);
        const costInput = document.getElementById('other-purchase-amount').value;
        const cost = parseFloat(costInput) || 0;
        if (cost <= 0) return;

        const remaining = plan.dailyAllowance - plan.dailySpent;
        if (cost > remaining) {
            if (!confirm('This exceeds your remaining allowance. Continue?')) return;
        }
        plan.dailySpent += cost;
        saveState();
        updatePlanHubUI();
        document.getElementById('other-purchase-amount').value = '';
    };

    // Product Modal
    document.getElementById('open-add-product-btn').onclick = () => document.getElementById('product-modal').classList.remove('hidden');
    document.getElementById('close-prod-modal').onclick = () => document.getElementById('product-modal').classList.add('hidden');
    document.getElementById('save-prod-btn').onclick = () => {
        const name = document.getElementById('prod-name').value;
        const price = parseFloat(document.getElementById('prod-price').value);
        if (!name || isNaN(price)) return;
        const plan = state.plans.find(p => p.id === currentPlanId);
        plan.products.push({ name, price });
        saveState();
        renderProducts();
        document.getElementById('product-modal').classList.add('hidden');
    };

    // Exclusion Modal
    document.getElementById('add-exclusion-btn').onclick = () => document.getElementById('exclusion-modal').classList.remove('hidden');
    document.getElementById('close-excl-modal').onclick = () => document.getElementById('exclusion-modal').classList.add('hidden');
    document.getElementById('save-excl-btn').onclick = () => {
        const start = document.getElementById('excl-start').value;
        const end = document.getElementById('excl-end').value;
        if (!start || !end) return alert('Select both dates');
        
        const plan = state.plans.find(p => p.id === currentPlanId);
        plan.exclusions = plan.exclusions || [];
        plan.exclusions.push({ start, end });
        
        refreshPlanTarget(plan);
        saveState();
        renderExclusions();
        updatePlanHubUI();
        if (document.querySelector('.tab-pane#reports-tab').classList.contains('active')) {
            renderPlanReports();
        }
        document.getElementById('exclusion-modal').classList.add('hidden');
    };

    // Delete Plan
    document.getElementById('delete-plan-btn').onclick = () => {
        document.getElementById('confirm-title').innerText = "Delete Plan?";
        document.getElementById('confirm-msg').innerText = "This will permanently remove this savings plan and all its data.";
        document.getElementById('confirm-modal').classList.remove('hidden');
        document.getElementById('confirm-ok').onclick = () => {
            state.plans = state.plans.filter(p => p.id !== currentPlanId);
            saveState();
            showScreen('home-screen');
            document.getElementById('confirm-modal').classList.add('hidden');
        };
    };
    document.getElementById('confirm-cancel').onclick = () => document.getElementById('confirm-modal').classList.add('hidden');
}

// Global window helpers for dynamic HTML
window.openPlanHub = openPlanHub;
window.deleteProduct = (idx) => {
    const plan = state.plans.find(p => p.id === currentPlanId);
    plan.products.splice(idx, 1);
    saveState();
    renderProducts();
};
window.buyProduct = (idx) => {
    const plan = state.plans.find(p => p.id === currentPlanId);
    const prod = plan.products[idx];
    const remaining = plan.dailyAllowance - plan.dailySpent;
    // Allow overspending if they really want to, which will affect savings
    if (prod.price > remaining) {
        if (!confirm('This exceeds your remaining allowance. Continue?')) return;
    }
    plan.dailySpent += prod.price;
    saveState();
    updatePlanHubUI();
};

window.deleteExclusion = (idx) => {
    const plan = state.plans.find(p => p.id === currentPlanId);
    plan.exclusions.splice(idx, 1);
    refreshPlanTarget(plan);
    saveState();
    renderExclusions();
    updatePlanHubUI();
    if (document.querySelector('.tab-pane#reports-tab').classList.contains('active')) {
        renderPlanReports();
    }
};

// --- Start ---
async function init() {
    // Load state from IndexedDB
    state = await Store.load();

    // Initialize missing state props (extra safety)
    state.history = state.history || [];
    state.plans = state.plans || [];
    state.totalSavings = state.totalSavings || 0;

    lucide.createIcons();
    checkDailyReset();
    
    // Auto-refresh when app comes back to focus to catch reset time flips
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkDailyReset();
            if (currentPlanId) updatePlanHubUI();
            if (document.getElementById('reports-screen').classList.contains('active')) renderGlobalReports();
        }
    });

    if (state.tosAgreed) {
        document.getElementById('tos-overlay').classList.add('hidden');
        document.getElementById('main-content').classList.remove('hidden');
    }
    renderPlans();
    setupEvents();
}

init();