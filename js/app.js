// State
let transactions = [];
let chartInstances = {};
const STORAGE_KEY = 'hyundaiCardTracker';

// API
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwjpCYqCQ4O_LvMfb5OnqGlpm76OCh3lvcnIChr46_MnqxYdPMWmALqAZAImcoblwCd6A/exec';

function getScriptUrl() {
  return localStorage.getItem(`${STORAGE_KEY}_url`) || DEFAULT_SCRIPT_URL;
}

function setScriptUrl(url) {
  localStorage.setItem(`${STORAGE_KEY}_url`, url);
}

async function apiGet(action, params = {}) {
  const url = new URL(getScriptUrl());
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  return res.json();
}

async function apiPost(data) {
  const res = await fetch(getScriptUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(data),
  });
  return res.json();
}

// Data
async function loadTransactions() {
  if (!getScriptUrl()) {
    document.getElementById('setupBanner').classList.add('visible');
    return;
  }

  try {
    const data = await apiGet('getData');
    transactions = (data.transactions || []).map(t => ({
      ...t,
      date: normalizeDate(t['날짜']),
      time: t['시간'] || '',
      store: t['가맹점'] || '',
      location: t['위치'] || '',
      amount: parseInt(t['금액'], 10) || 0,
      category: t['카테고리'] || '기타',
      memo: t['메모'] || '',
      row: t.row,
    }));

    transactions.sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      return d !== 0 ? d : (b.time || '').localeCompare(a.time || '');
    });

    updateSummary();
    renderDashboard();
    renderTransactions();
    toast('데이터 로드 완료', 'success');
  } catch (e) {
    toast('데이터 로드 실패: ' + e.message, 'error');
  }
}

function normalizeDate(d) {
  if (!d) return '';
  if (typeof d === 'string' && d.match(/^\d{4}-\d{2}-\d{2}$/)) return d;
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return String(d);
    return dt.toISOString().split('T')[0];
  } catch {
    return String(d);
  }
}

// Summary
function updateSummary() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const startOfWeek = getStartOfWeek(now);
  const currentMonth = today.substring(0, 7);
  const currentYear = today.substring(0, 4);

  const todayTx = transactions.filter(t => t.date === today);
  const weekTx = transactions.filter(t => t.date >= startOfWeek);
  const monthTx = transactions.filter(t => t.date.startsWith(currentMonth));
  const yearTx = transactions.filter(t => t.date.startsWith(currentYear));

  const todaySum = sum(todayTx);
  const weekSum = sum(weekTx);
  const monthSum = sum(monthTx);
  const yearSum = sum(yearTx);

  document.getElementById('todayTotal').textContent = formatMoney(todaySum);
  document.getElementById('todayCount').textContent = `${todayTx.length}건`;

  document.getElementById('weekTotal').textContent = formatMoney(weekSum);
  const daysInWeek = Math.max(1, daysBetween(startOfWeek, today) + 1);
  document.getElementById('weekAvg').textContent = `일평균 ${formatMoney(Math.round(weekSum / daysInWeek))}`;

  document.getElementById('monthTotal').textContent = formatMoney(monthSum);
  document.getElementById('monthCount').textContent = `${monthTx.length}건`;

  document.getElementById('yearTotal').textContent = formatMoney(yearSum);
  const monthsElapsed = now.getMonth() + 1;
  document.getElementById('yearMonthAvg').textContent = `월평균 ${formatMoney(Math.round(yearSum / monthsElapsed))}`;
}

// Dashboard Charts
function renderDashboard() {
  const period = document.getElementById('chartPeriod').value;
  const filtered = filterByPeriod(transactions, period);

  renderDailyChart(filtered, period);
  renderCategoryBarChart(filtered);
  renderCategoryPieChart(filtered);
}

function filterByPeriod(tx, period) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  switch (period) {
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      const from = d.toISOString().split('T')[0];
      return tx.filter(t => t.date >= from && t.date <= today);
    }
    case 'month': {
      const from = today.substring(0, 7);
      return tx.filter(t => t.date.startsWith(from));
    }
    case '3months': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 2);
      d.setDate(1);
      const from = d.toISOString().split('T')[0];
      return tx.filter(t => t.date >= from && t.date <= today);
    }
    case 'year': {
      const from = today.substring(0, 4);
      return tx.filter(t => t.date.startsWith(from));
    }
    default:
      return tx;
  }
}

function renderDailyChart(filtered, period) {
  const dailyMap = {};
  for (const t of filtered) {
    dailyMap[t.date] = (dailyMap[t.date] || 0) + t.amount;
  }

  const dates = Object.keys(dailyMap).sort();

  if (period === 'week' || period === 'month') {
    const allDates = fillDateRange(dates, period);
    const amounts = allDates.map(d => dailyMap[d] || 0);
    createOrUpdateChart('dailyChart', 'bar', {
      labels: allDates.map(d => formatDateShort(d)),
      datasets: [{
        label: '일별 지출',
        data: amounts,
        backgroundColor: 'rgba(108, 92, 231, 0.6)',
        borderColor: 'rgba(108, 92, 231, 1)',
        borderWidth: 1,
        borderRadius: 6,
      }]
    }, {
      scales: {
        y: {
          ticks: { callback: v => formatMoneyShort(v) },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        x: { grid: { display: false } }
      }
    });
  } else {
    const monthlyMap = {};
    for (const t of filtered) {
      const m = t.date.substring(0, 7);
      monthlyMap[m] = (monthlyMap[m] || 0) + t.amount;
    }
    const months = Object.keys(monthlyMap).sort();
    createOrUpdateChart('dailyChart', 'bar', {
      labels: months.map(m => m.substring(5) + '월'),
      datasets: [{
        label: '월별 지출',
        data: months.map(m => monthlyMap[m]),
        backgroundColor: 'rgba(108, 92, 231, 0.6)',
        borderColor: 'rgba(108, 92, 231, 1)',
        borderWidth: 1,
        borderRadius: 6,
      }]
    }, {
      scales: {
        y: {
          ticks: { callback: v => formatMoneyShort(v) },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        x: { grid: { display: false } }
      }
    });
  }
}

function renderCategoryBarChart(filtered) {
  const catMap = {};
  for (const t of filtered) {
    catMap[t.category] = (catMap[t.category] || 0) + t.amount;
  }

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const colors = getCategoryColors(sorted.map(s => s[0]));

  createOrUpdateChart('categoryChart', 'bar', {
    labels: sorted.map(s => s[0]),
    datasets: [{
      data: sorted.map(s => s[1]),
      backgroundColor: colors.map(c => c + 'cc'),
      borderColor: colors,
      borderWidth: 1,
      borderRadius: 6,
    }]
  }, {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: {
        ticks: { callback: v => formatMoneyShort(v) },
        grid: { color: 'rgba(255,255,255,0.05)' }
      },
      y: { grid: { display: false } }
    }
  });
}

function renderCategoryPieChart(filtered) {
  const catMap = {};
  for (const t of filtered) {
    catMap[t.category] = (catMap[t.category] || 0) + t.amount;
  }

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const colors = getCategoryColors(sorted.map(s => s[0]));

  createOrUpdateChart('categoryPieChart', 'doughnut', {
    labels: sorted.map(s => s[0]),
    datasets: [{
      data: sorted.map(s => s[1]),
      backgroundColor: colors.map(c => c + 'cc'),
      borderColor: '#1a1a24',
      borderWidth: 2,
    }]
  }, {
    plugins: {
      legend: {
        position: 'right',
        labels: { padding: 12, usePointStyle: true, font: { size: 12 } }
      },
      tooltip: {
        callbacks: {
          label: ctx => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = ((ctx.parsed / total) * 100).toFixed(1);
            return `${ctx.label}: ${formatMoney(ctx.parsed)} (${pct}%)`;
          }
        }
      }
    }
  });
}

// Analysis Tab
function renderAnalysis() {
  const type = document.getElementById('analysisPeriod').value;

  switch (type) {
    case 'monthly': return renderMonthlyComparison();
    case 'weekday': return renderWeekdayPattern();
    case 'hourly': return renderHourlyPattern();
    case 'top-stores': return renderTopStores();
  }
}

function renderMonthlyComparison() {
  document.getElementById('analysisTitle').textContent = '월별 지출 비교';
  document.getElementById('analysisDetailTitle').textContent = '월별 카테고리 구성';

  const monthlyMap = {};
  const monthlyCatMap = {};

  for (const t of transactions) {
    const m = t.date.substring(0, 7);
    monthlyMap[m] = (monthlyMap[m] || 0) + t.amount;
    if (!monthlyCatMap[m]) monthlyCatMap[m] = {};
    monthlyCatMap[m][t.category] = (monthlyCatMap[m][t.category] || 0) + t.amount;
  }

  const months = Object.keys(monthlyMap).sort().slice(-12);

  createOrUpdateChart('analysisChart', 'bar', {
    labels: months.map(m => m.substring(5) + '월'),
    datasets: [{
      label: '월별 지출',
      data: months.map(m => monthlyMap[m]),
      backgroundColor: 'rgba(116, 185, 255, 0.6)',
      borderColor: 'rgba(116, 185, 255, 1)',
      borderWidth: 1,
      borderRadius: 6,
    }]
  }, {
    scales: {
      y: { ticks: { callback: v => formatMoneyShort(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
      x: { grid: { display: false } }
    }
  });

  const allCats = [...new Set(transactions.map(t => t.category))];
  const catColors = getCategoryColors(allCats);
  const datasets = allCats.map((cat, i) => ({
    label: cat,
    data: months.map(m => (monthlyCatMap[m] || {})[cat] || 0),
    backgroundColor: catColors[i] + 'cc',
  }));

  createOrUpdateChart('analysisDetailChart', 'bar', {
    labels: months.map(m => m.substring(5) + '월'),
    datasets,
  }, {
    plugins: { legend: { position: 'bottom', labels: { padding: 8, usePointStyle: true, font: { size: 11 } } } },
    scales: {
      x: { stacked: true, grid: { display: false } },
      y: { stacked: true, ticks: { callback: v => formatMoneyShort(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
    }
  });
}

function renderWeekdayPattern() {
  document.getElementById('analysisTitle').textContent = '요일별 지출 패턴';
  document.getElementById('analysisDetailTitle').textContent = '요일별 평균 지출';

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayTotals = Array(7).fill(0);
  const dayCounts = Array(7).fill(0);
  const dayTxCounts = Array(7).fill(0);

  const daysSet = Array.from({ length: 7 }, () => new Set());

  for (const t of transactions) {
    const d = new Date(t.date);
    const day = d.getDay();
    dayTotals[day] += t.amount;
    dayTxCounts[day]++;
    daysSet[day].add(t.date);
  }

  for (let i = 0; i < 7; i++) {
    dayCounts[i] = Math.max(1, daysSet[i].size);
  }

  const dayAvg = dayTotals.map((total, i) => Math.round(total / dayCounts[i]));

  createOrUpdateChart('analysisChart', 'bar', {
    labels: dayNames,
    datasets: [{
      label: '총 지출',
      data: dayTotals,
      backgroundColor: dayNames.map((_, i) => i === 0 || i === 6 ? 'rgba(253, 121, 168, 0.6)' : 'rgba(108, 92, 231, 0.6)'),
      borderRadius: 6,
    }]
  }, {
    scales: {
      y: { ticks: { callback: v => formatMoneyShort(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
      x: { grid: { display: false } }
    }
  });

  createOrUpdateChart('analysisDetailChart', 'bar', {
    labels: dayNames,
    datasets: [{
      label: '평균 지출',
      data: dayAvg,
      backgroundColor: dayNames.map((_, i) => i === 0 || i === 6 ? 'rgba(253, 121, 168, 0.6)' : 'rgba(0, 184, 148, 0.6)'),
      borderRadius: 6,
    }]
  }, {
    scales: {
      y: { ticks: { callback: v => formatMoneyShort(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
      x: { grid: { display: false } }
    }
  });
}

function renderHourlyPattern() {
  document.getElementById('analysisTitle').textContent = '시간대별 지출';
  document.getElementById('analysisDetailTitle').textContent = '시간대별 건수';

  const hourTotals = Array(24).fill(0);
  const hourCounts = Array(24).fill(0);

  for (const t of transactions) {
    if (!t.time) continue;
    const hour = parseInt(t.time.split(':')[0], 10);
    if (isNaN(hour)) continue;
    hourTotals[hour] += t.amount;
    hourCounts[hour]++;
  }

  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}시`);

  createOrUpdateChart('analysisChart', 'bar', {
    labels,
    datasets: [{
      label: '시간대별 지출',
      data: hourTotals,
      backgroundColor: 'rgba(253, 203, 110, 0.6)',
      borderRadius: 4,
    }]
  }, {
    scales: {
      y: { ticks: { callback: v => formatMoneyShort(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }
    }
  });

  createOrUpdateChart('analysisDetailChart', 'bar', {
    labels,
    datasets: [{
      label: '건수',
      data: hourCounts,
      backgroundColor: 'rgba(116, 185, 255, 0.6)',
      borderRadius: 4,
    }]
  }, {
    scales: {
      y: { grid: { color: 'rgba(255,255,255,0.05)' } },
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }
    }
  });
}

function renderTopStores() {
  document.getElementById('analysisTitle').textContent = '자주 가는 가맹점 (금액 기준)';
  document.getElementById('analysisDetailTitle').textContent = '자주 가는 가맹점 (횟수 기준)';

  const storeAmount = {};
  const storeCount = {};

  for (const t of transactions) {
    storeAmount[t.store] = (storeAmount[t.store] || 0) + t.amount;
    storeCount[t.store] = (storeCount[t.store] || 0) + 1;
  }

  const topByAmount = Object.entries(storeAmount).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const topByCount = Object.entries(storeCount).sort((a, b) => b[1] - a[1]).slice(0, 15);

  createOrUpdateChart('analysisChart', 'bar', {
    labels: topByAmount.map(s => s[0]),
    datasets: [{
      data: topByAmount.map(s => s[1]),
      backgroundColor: 'rgba(108, 92, 231, 0.6)',
      borderRadius: 6,
    }]
  }, {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { callback: v => formatMoneyShort(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { grid: { display: false } }
    }
  });

  createOrUpdateChart('analysisDetailChart', 'bar', {
    labels: topByCount.map(s => s[0]),
    datasets: [{
      label: '방문 횟수',
      data: topByCount.map(s => s[1]),
      backgroundColor: 'rgba(0, 184, 148, 0.6)',
      borderRadius: 6,
    }]
  }, {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { grid: { display: false } }
    }
  });
}

// Transactions Tab
function renderTransactions() {
  const monthInput = document.getElementById('txMonth');
  const catFilter = document.getElementById('txCategory').value;
  const search = document.getElementById('txSearch').value.toLowerCase();

  let filtered = transactions;

  if (monthInput.value) {
    filtered = filtered.filter(t => t.date.startsWith(monthInput.value));
  }
  if (catFilter) {
    filtered = filtered.filter(t => t.category === catFilter);
  }
  if (search) {
    filtered = filtered.filter(t =>
      t.store.toLowerCase().includes(search) ||
      t.location.toLowerCase().includes(search)
    );
  }

  document.getElementById('txCount').textContent =
    `${filtered.length}건 · ${formatMoney(sum(filtered))}`;

  const body = document.getElementById('txBody');

  if (filtered.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <h3>거래 내역이 없습니다</h3>
        <p>현대카드 알림 자동화를 설정하거나 수동으로 입력하세요.</p>
      </div>`;
    return;
  }

  body.innerHTML = filtered.map(t => `
    <div class="transaction-item">
      <div class="transaction-date">${formatDateShort(t.date)}<br><small>${t.time}</small></div>
      <div class="transaction-store">${escapeHtml(t.store)}<br><span class="location">${escapeHtml(t.location)}</span></div>
      <div class="transaction-category" onclick="openCategoryEdit(${t.row}, '${escapeAttr(t.category)}')">${escapeHtml(t.category)}</div>
      <div class="transaction-amount">${formatMoney(t.amount)}</div>
      <div class="transaction-actions">
        <button onclick="deleteTransaction(${t.row})" title="삭제">×</button>
      </div>
    </div>
  `).join('');
}

// Modals
function openAddModal() {
  const now = new Date();
  document.getElementById('formDate').value = now.toISOString().split('T')[0];
  document.getElementById('formTime').value = now.toTimeString().substring(0, 5);
  document.getElementById('formStore').value = '';
  document.getElementById('formLocation').value = '';
  document.getElementById('formAmount').value = '';
  document.getElementById('formCategory').value = '식비';
  document.getElementById('formMemo').value = '';
  document.getElementById('addModal').classList.add('open');
}

async function submitAdd() {
  const data = {
    action: 'addTransaction',
    date: document.getElementById('formDate').value,
    time: document.getElementById('formTime').value,
    store: document.getElementById('formStore').value,
    location: document.getElementById('formLocation').value,
    amount: document.getElementById('formAmount').value,
    category: document.getElementById('formCategory').value,
    memo: document.getElementById('formMemo').value,
  };

  if (!data.store || !data.amount) {
    toast('가맹점과 금액을 입력하세요.', 'error');
    return;
  }

  try {
    await apiPost(data);
    document.getElementById('addModal').classList.remove('open');
    toast('저장 완료', 'success');
    await loadTransactions();
  } catch (e) {
    toast('저장 실패: ' + e.message, 'error');
  }
}

let editingRow = null;

function openCategoryEdit(row, currentCat) {
  editingRow = row;
  document.getElementById('editCategory').value = currentCat;
  document.getElementById('categoryModal').classList.add('open');
}

async function saveCategory() {
  if (!editingRow) return;
  try {
    await apiPost({
      action: 'updateCategory',
      row: editingRow,
      category: document.getElementById('editCategory').value,
    });
    document.getElementById('categoryModal').classList.remove('open');
    toast('카테고리 변경 완료', 'success');
    await loadTransactions();
  } catch (e) {
    toast('변경 실패: ' + e.message, 'error');
  }
}

async function deleteTransaction(row) {
  if (!confirm('이 거래를 삭제하시겠습니까?')) return;
  try {
    await apiPost({ action: 'deleteTransaction', row });
    toast('삭제 완료', 'success');
    await loadTransactions();
  } catch (e) {
    toast('삭제 실패: ' + e.message, 'error');
  }
}

// Chart Helpers
function createOrUpdateChart(canvasId, type, data, options = {}) {
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }

  const ctx = document.getElementById(canvasId).getContext('2d');

  const defaultOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: type === 'doughnut', labels: { color: '#e4e4ed' } },
      tooltip: {
        callbacks: {
          label: ctx => {
            if (type === 'doughnut') return ctx.label + ': ' + formatMoney(ctx.parsed);
            return (ctx.dataset.label || '') + ': ' + formatMoney(ctx.parsed.y || ctx.parsed);
          }
        }
      }
    },
    scales: type === 'doughnut' ? {} : {
      x: { ticks: { color: '#8888a4' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { ticks: { color: '#8888a4' }, grid: { color: 'rgba(255,255,255,0.05)' } },
    }
  };

  const merged = deepMerge(defaultOptions, options);

  chartInstances[canvasId] = new Chart(ctx, { type, data, options: merged });
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

const CATEGORY_COLORS = {
  '식비': '#e17055',
  '편의점': '#fdcb6e',
  '마트/쇼핑': '#6c5ce7',
  '교통': '#74b9ff',
  '문화/여가': '#fd79a8',
  '의료': '#00b894',
  '통신': '#0984e3',
  '구독': '#a29bfe',
  '기타생활': '#55efc4',
  '기타': '#636e72',
};

function getCategoryColors(categories) {
  return categories.map(c => CATEGORY_COLORS[c] || '#636e72');
}

// Utility
function sum(arr) {
  return arr.reduce((s, t) => s + t.amount, 0);
}

function formatMoney(n) {
  if (n === 0) return '₩0';
  return '₩' + n.toLocaleString('ko-KR');
}

function formatMoneyShort(n) {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + '천만';
  if (n >= 10000) return (n / 10000).toFixed(0) + '만';
  return n.toLocaleString('ko-KR');
}

function formatDateShort(d) {
  if (!d || d.length < 10) return d;
  const parts = d.split('-');
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

function fillDateRange(dates, period) {
  const now = new Date();
  let start, end;

  if (period === 'week') {
    end = now;
    start = new Date(now);
    start.setDate(start.getDate() - 6);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = now;
  } else {
    if (dates.length === 0) return [];
    start = new Date(dates[0]);
    end = new Date(dates[dates.length - 1]);
  }

  const result = [];
  const d = new Date(start);
  while (d <= end) {
    result.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return result;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function toast(msg, type = 'success') {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).style.display = 'block';

      if (tab.dataset.tab === 'analysis') renderAnalysis();
      if (tab.dataset.tab === 'transactions') renderTransactions();
    });
  });

  // Chart period
  document.getElementById('chartPeriod').addEventListener('change', renderDashboard);

  // Analysis period
  document.getElementById('analysisPeriod').addEventListener('change', renderAnalysis);

  // Transaction filters
  document.getElementById('txMonth').addEventListener('change', renderTransactions);
  document.getElementById('txCategory').addEventListener('change', renderTransactions);
  document.getElementById('txSearch').addEventListener('input', renderTransactions);

  // Set default month
  const now = new Date();
  document.getElementById('txMonth').value = now.toISOString().substring(0, 7);

  // Populate category filter
  const catSelect = document.getElementById('txCategory');
  Object.keys(CATEGORY_COLORS).forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    catSelect.appendChild(opt);
  });

  // Setup
  document.getElementById('btnSetup').addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.querySelector('[data-tab="setup"]').classList.add('active');
    document.getElementById('tab-setup').style.display = 'block';
    document.getElementById('setupScriptUrl').value = getScriptUrl();
  });

  document.getElementById('btnGuide').addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.querySelector('[data-tab="setup"]').classList.add('active');
    document.getElementById('tab-setup').style.display = 'block';
  });

  // URL Save
  document.getElementById('btnSaveUrl').addEventListener('click', () => {
    const url = document.getElementById('scriptUrl').value.trim();
    if (!url) return toast('URL을 입력하세요', 'error');
    setScriptUrl(url);
    document.getElementById('setupBanner').classList.remove('visible');
    toast('URL 저장 완료', 'success');
    loadTransactions();
  });

  document.getElementById('btnSetupSave').addEventListener('click', () => {
    const url = document.getElementById('setupScriptUrl').value.trim();
    if (!url) return toast('URL을 입력하세요', 'error');
    setScriptUrl(url);
    document.getElementById('setupBanner').classList.remove('visible');
    toast('URL 저장 완료', 'success');
    loadTransactions();
  });

  document.getElementById('btnTestConnection').addEventListener('click', async () => {
    const resultEl = document.getElementById('testResult');
    resultEl.textContent = '연결 테스트 중...';
    resultEl.style.color = 'var(--text-dim)';
    try {
      const data = await apiGet('getData');
      resultEl.textContent = `연결 성공! ${(data.transactions || []).length}건의 데이터가 있습니다.`;
      resultEl.style.color = 'var(--green)';
    } catch (e) {
      resultEl.textContent = '연결 실패: ' + e.message;
      resultEl.style.color = 'var(--red)';
    }
  });

  // Add modal
  document.getElementById('btnAdd').addEventListener('click', openAddModal);
  document.getElementById('btnCancelAdd').addEventListener('click', () => {
    document.getElementById('addModal').classList.remove('open');
  });
  document.getElementById('btnSubmitAdd').addEventListener('click', submitAdd);

  // Category modal
  document.getElementById('btnCancelCategory').addEventListener('click', () => {
    document.getElementById('categoryModal').classList.remove('open');
  });
  document.getElementById('btnSaveCategory').addEventListener('click', saveCategory);

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Load
  if (getScriptUrl()) {
    loadTransactions();
  } else {
    document.getElementById('setupBanner').classList.add('visible');
  }
});
