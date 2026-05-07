const SHEET_NAME = '지출내역';

function doGet(e) {
  const action = e.parameter.action;

  if (action === 'getData') {
    return getTransactions(e);
  }

  if (action === 'getCategories') {
    return jsonResponse(getCategoryMap());
  }

  return jsonResponse({ error: 'Unknown action' });
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;

  if (action === 'addTransaction') {
    return addTransaction(data);
  }

  if (action === 'addFromNotification') {
    return addFromNotification(data);
  }

  if (action === 'updateCategory') {
    return updateCategory(data);
  }

  if (action === 'deleteTransaction') {
    return deleteTransaction(data);
  }

  return jsonResponse({ error: 'Unknown action' });
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const headers = ['날짜', '시간', '가맹점', '위치', '금액', '카테고리', '메모'];
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = firstRow[0] === headers[0] && firstRow[2] === headers[2];

  if (!hasHeaders) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange('1:1').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function addFromNotification(data) {
  const raw = data.text || '';
  const entries = parseNotification(raw);

  if (!entries || entries.length === 0) {
    return jsonResponse({ success: false, error: 'Parse failed', raw: raw });
  }

  const sheet = getOrCreateSheet();
  const existing = getExistingKeys(sheet);
  const added = [];
  const skipped = [];

  for (const parsed of entries) {
    const key = parsed.store + '|' + parsed.amount + '|' + parsed.date;
    if (existing.has(key)) {
      skipped.push({ store: parsed.store, amount: parsed.amount, reason: '중복' });
      continue;
    }

    const category = guessCategory(parsed.store);
    sheet.appendRow([
      parsed.date,
      parsed.time,
      parsed.store,
      parsed.location,
      parsed.amount,
      category,
      parsed.memo || ''
    ]);
    existing.add(key);
    added.push({ store: parsed.store, amount: parsed.amount, category: category });
  }

  return jsonResponse({
    success: true,
    count: added.length,
    added: added,
    skipped: skipped.length,
    skippedDetail: skipped
  });
}

function getExistingKeys(sheet) {
  const keys = new Set();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    let dateVal = data[i][0];
    if (dateVal instanceof Date) {
      dateVal = Utilities.formatDate(dateVal, 'Asia/Seoul', 'yyyy-MM-dd');
    }
    const store = String(data[i][2]);
    const amount = Number(data[i][4]);
    keys.add(store + '|' + amount + '|' + String(dateVal));
  }

  return keys;
}

function parseNotification(text) {
  try {
    const results = [];
    const parsedByFormatB = parseFormatB(text);
    const parsedByFormatA = parseFormatA(text);

    for (const p of parsedByFormatB) {
      if (!results.some(r => r.store === p.store && r.amount === p.amount)) {
        results.push(p);
      }
    }
    for (const p of parsedByFormatA) {
      if (!results.some(r => r.store === p.store && r.amount === p.amount)) {
        results.push(p);
      }
    }

    return results.length > 0 ? results : null;
  } catch (e) {
    return null;
  }
}

function parseFormatB(text) {
  const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l);
  const results = [];
  const now = new Date();
  const currentYear = now.getFullYear();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const amountMatch = line.match(/^([\d,]+)원\s*(일시불|할부)/);
    if (!amountMatch) continue;

    const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
    if (!amount || amount < 10) continue;

    let isCancel = false;
    for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
      if (lines[j].includes('승인취소')) { isCancel = true; break; }
    }

    let date = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');
    let time = Utilities.formatDate(now, 'Asia/Seoul', 'HH:mm');
    const dateMatch = line.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (dateMatch) {
      const month = String(dateMatch[1]).padStart(2, '0');
      const day = String(dateMatch[2]).padStart(2, '0');
      date = currentYear + '-' + month + '-' + day;
      time = String(dateMatch[3]).padStart(2, '0') + ':' + dateMatch[4];
    }

    let store = '';
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 2); j++) {
      const next = lines[j];
      if (next.includes('누적')) continue;
      if (next.match(/^\d/) || next.length < 2) continue;
      if (next.includes('현대카드') || next.includes('간략히')) continue;
      store = next;
      break;
    }

    if (!store || !amount) continue;

    store = store.replace(/[^\w가-힣a-zA-Z0-9\s]/g, '').trim();

    const finalAmount = isCancel ? -amount : amount;

    if (!results.some(r => r.store === store && r.amount === finalAmount)) {
      results.push({ date, time, store, location: '', amount: finalAmount, memo: isCancel ? '승인취소' : '' });
    }
  }

  return results;
}

function parseFormatA(text) {
  const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l);
  const noise = ['지갑', '간략히', '보기', '설정', '알림', '광고', '예약', '확인', '누적'];
  const results = [];
  const now = new Date();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const amountMatch = line.match(/[₩￦][,\s]?([\d,]+)/);
    if (!amountMatch) continue;

    const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
    if (!amount || amount < 10) continue;
    if (line.includes('누적')) continue;

    let store = '';
    let location = '';

    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const prev = lines[j];
      if (prev.includes('현대카드')) continue;
      if (prev.match(/^\d{1,2}:\d{2}$/) || prev.match(/^오[전후]/)) continue;
      if (prev.match(/^어제/) || prev.match(/^오늘/)) continue;
      if (noise.some(n => prev.includes(n))) continue;
      if (prev.match(/^\d+\.\d+/) || prev.length < 2) continue;

      if (prev.includes(',')) {
        const parts = prev.split(',').map(p => p.trim());
        const locPart = parts.find(p => p.includes('시') || p.includes('도') || p.includes('군') || p.includes('구'));
        if (locPart) {
          store = parts.filter(p => p !== locPart).join(' ').trim();
          location = locPart.trim();
        } else {
          store = parts[0];
          location = parts.slice(1).join(', ');
        }
      } else {
        store = prev;
      }
      break;
    }

    if (!store || !amount) continue;

    store = store.replace(/[^\w가-힣a-zA-Z0-9\s]/g, '').trim();

    if (!results.some(r => r.store === store && r.amount === amount)) {
      results.push({
        date: Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd'),
        time: Utilities.formatDate(now, 'Asia/Seoul', 'HH:mm'),
        store, location, amount
      });
    }
  }

  return results;
}

function addTransaction(data) {
  const sheet = getOrCreateSheet();
  const category = data.category || guessCategory(data.store || '');

  sheet.appendRow([
    data.date || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'),
    data.time || Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH:mm'),
    data.store || '',
    data.location || '',
    parseInt(data.amount, 10) || 0,
    category,
    data.memo || ''
  ]);

  return jsonResponse({ success: true });
}

function getTransactions(e) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return jsonResponse({ transactions: [] });
  }

  const transactions = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    let dateVal = r[0];
    let timeVal = r[1];

    if (dateVal instanceof Date) {
      dateVal = Utilities.formatDate(dateVal, 'Asia/Seoul', 'yyyy-MM-dd');
    }
    if (timeVal instanceof Date) {
      timeVal = Utilities.formatDate(timeVal, 'Asia/Seoul', 'HH:mm');
    }

    transactions.push({
      '날짜': String(dateVal),
      '시간': String(timeVal),
      '가맹점': String(r[2]),
      '위치': String(r[3]),
      '금액': Number(r[4]),
      '카테고리': String(r[5]),
      '메모': String(r[6] || ''),
      'row': i + 1
    });
  }

  return jsonResponse({ transactions });
}

function updateCategory(data) {
  const sheet = getOrCreateSheet();
  const row = data.row;
  if (row < 2) return jsonResponse({ success: false, error: 'Invalid row' });

  sheet.getRange(row, 6).setValue(data.category);
  return jsonResponse({ success: true });
}

function deleteTransaction(data) {
  const sheet = getOrCreateSheet();
  const row = data.row;
  if (row < 2) return jsonResponse({ success: false, error: 'Invalid row' });

  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

function guessCategory(store) {
  const categories = {
    '식비': ['식당', '레스토랑', '카페', '커피', '치킨', '피자', '맥도날드', '버거킹', '롯데리아', 'KFC', '스타벅스', '이디야', '투썸', '빽다방', '메가커피', '중식', '한식', '일식', '분식', '국밥', '찌개', '삼겹살', '곱창', '냉면', '김밥', '떡볶이', '도시락', '베이커리', '빵', '풍미'],
    '편의점': ['GS25', 'GS 25', 'CU', '세븐일레븐', '이마트24', '미니스톱'],
    '마트/쇼핑': ['이마트', '홈플러스', '롯데마트', '코스트코', '트레이더스', '다이소', '올리브영', '쿠팡', '네이버', '무신사', '마켓컬리'],
    '교통': ['택시', '카카오T', '주유소', 'SK에너지', 'GS칼텍스', 'S-OIL', '고속버스', 'KTX', 'SRT', '코레일', '주차', '톨게이트', '하이패스'],
    '문화/여가': ['CGV', '메가박스', '롯데시네마', '넷플릭스', '왓챠', '디즈니', '멜론', '스포티파이', '유튜브', '게임', '노래방', 'PC방'],
    '의료': ['약국', '병원', '의원', '치과', '안과', '피부과', '한의원'],
    '통신': ['SKT', 'KT', 'LGU', '알뜰폰'],
    '구독': ['애플', 'Apple', 'Google', '구글', '아마존', 'Amazon'],
    '기타생활': ['세탁', '미용', '헤어', '네일', '뷰티']
  };

  const storeLower = store.toLowerCase();
  for (const [category, keywords] of Object.entries(categories)) {
    for (const keyword of keywords) {
      if (storeLower.includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }

  return '기타';
}

function getCategoryMap() {
  return ['식비', '편의점', '마트/쇼핑', '교통', '문화/여가', '의료', '통신', '구독', '기타생활', '기타'];
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
