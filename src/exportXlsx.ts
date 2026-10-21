import ExcelJS from 'exceljs';

import type {Milestone, Roadmap, Task} from './types';

// дни от 1970-01-01 (UTC), как на ганте
const DAY = 864e5;
const toDay = (s: string) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
const asDate = (s: string) => new Date(toDay(s) * DAY);
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const BAR = 'FF9CC8F5';
const HEAD = 'FFEFEFEF';
const TODAY = 'FFFFD7D7';

/** markdown описания — в простой текст для ячейки */
const plain = (md: string) =>
    md
        .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
        .replace(/(\*\*|__|\+\+|~~|`)/g, '')
        .replace(/^\s*[-*]\s+/gm, '• ')
        .trim();

export type ExportMap = Pick<Roadmap, 'title' | 'description' | 'scale' | 'from' | 'to' | 'milestones'>;

/**
 * Дорожная карта в xlsx: лист «Вехи» — таблица, а справа от неё таймлайн с закрашенными ячейками.
 * tasksOf есть только у владельца: по публичной ссылке задачи не выгружаются.
 */
export async function exportRoadmap(map: ExportMap, period: string, tasksOf?: (m: Milestone) => Task[]) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Муравей';
    const byId = new Map(map.milestones.map((m) => [m.id, m]));
    const items = [...map.milestones].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const blockers = (m: Milestone) =>
        (m.blockedBy ?? [])
            .map((id) => byId.get(id)?.title)
            .filter(Boolean)
            .join(', ');

    /* ---------- лист «Вехи» ---------- */
    const ws = wb.addWorksheet('Вехи');
    const cols = [
        {header: 'Веха', width: 36},
        {header: 'Начало', width: 13},
        {header: 'Конец', width: 13},
        {header: 'Дней', width: 8},
        {header: 'Ответственный', width: 24},
        {header: 'Блокируется вехами', width: 32},
        ...(tasksOf ? [{header: 'Задачи', width: 48}] : []),
    ];
    cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
    const last = cols.length;

    ws.getCell(1, 1).value = map.title;
    ws.getCell(1, 1).font = {bold: true, size: 14};
    ws.getCell(2, 1).value = period;
    ws.getCell(2, 1).font = {color: {argb: 'FF666666'}};
    let row = 3;
    const desc = plain(map.description ?? '');
    if (desc) {
        ws.mergeCells(row, 1, row, last);
        const c = ws.getCell(row, 1);
        c.value = desc;
        c.alignment = {wrapText: true, vertical: 'top'};
        ws.getRow(row).height = Math.min(300, 15 * (desc.split('\n').length + Math.floor(desc.length / 140)));
        row++;
    }
    row++;
    const head = ws.getRow(row);
    cols.forEach((c, i) => {
        const cell = head.getCell(i + 1);
        cell.value = c.header;
        cell.font = {bold: true};
        cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: HEAD}};
    });
    for (const m of items) {
        row++;
        const r = ws.getRow(row);
        r.getCell(1).value = m.title;
        r.getCell(2).value = asDate(m.start);
        r.getCell(3).value = asDate(m.end);
        r.getCell(2).numFmt = r.getCell(3).numFmt = 'dd.mm.yyyy';
        r.getCell(4).value = toDay(m.end) - toDay(m.start) + 1;
        r.getCell(5).value = m.owner ?? '';
        r.getCell(6).value = blockers(m);
        if (tasksOf) {
            const ts = tasksOf(m);
            r.getCell(7).value = ts.map((t) => `${t.done ? '✓' : '○'} ${t.title}`).join('\n');
        }
        r.eachCell((c) => (c.alignment = {wrapText: true, vertical: 'top'}));
    }

    /* ---------- таймлайн справа от таблицы: недели (у масштаба «Годы» — месяцы) ---------- */
    const rs = toDay(map.from + '-01');
    const re = Math.round(Date.UTC(+map.to.slice(0, 4), +map.to.slice(5, 7), 0) / DAY);
    const slots: {a: number; b: number; key: string; group: string; label: string}[] = [];
    if (map.scale === 'months') {
        // недели с понедельника; 1970-01-01 — четверг
        let a = rs - ((rs + 3) % 7);
        while (a <= re) {
            const d = new Date(Math.max(a, rs) * DAY);
            slots.push({
                a,
                b: a + 6,
                key: String(a),
                group: `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
                label: String(new Date(a * DAY).getUTCDate()),
            });
            a += 7;
        }
    } else {
        for (let y = +map.from.slice(0, 4); y <= +map.to.slice(0, 4); y++) {
            for (let m = 0; m < 12; m++) {
                const a = Date.UTC(y, m, 1) / DAY;
                const b = Date.UTC(y, m + 1, 0) / DAY;
                if (b < rs || a > re) continue;
                slots.push({a, b, key: `${y}-${m}`, group: String(y), label: MONTHS_SHORT[m]});
            }
        }
    }
    const first = last + 2; // одна пустая колонка между таблицей и таймлайном
    slots.forEach((_, k) => (ws.getColumn(first + k).width = map.scale === 'months' ? 3.2 : 4.5));
    const headRow = ws.getRow(row - items.length);
    const groupRow = ws.getRow(row - items.length - 1);
    let k = 0;
    while (k < slots.length) {
        let j = k;
        while (j + 1 < slots.length && slots[j + 1].group === slots[k].group) j++;
        if (j > k) ws.mergeCells(groupRow.number, first + k, groupRow.number, first + j);
        const c = groupRow.getCell(first + k);
        c.value = slots[k].group;
        c.font = {bold: true};
        c.alignment = {horizontal: 'left'};
        k = j + 1;
    }
    const today = Math.floor(Date.now() / DAY);
    slots.forEach((slot, n) => {
        const c = headRow.getCell(first + n);
        c.value = slot.label;
        c.font = {size: 9, color: {argb: 'FF666666'}};
        c.alignment = {horizontal: 'center'};
        c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: slot.a <= today && today <= slot.b ? TODAY : HEAD}};
    });
    items.forEach((m, i) => {
        const r = ws.getRow(headRow.number + 1 + i);
        const s = toDay(m.start);
        const e = toDay(m.end);
        slots.forEach((slot, n) => {
            if (slot.a <= e && slot.b >= s) {
                r.getCell(first + n).fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: BAR}};
            }
        });
    });
    ws.views = [{state: 'frozen', xSplit: 1, ySplit: headRow.number}];

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(
        new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${map.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'roadmap'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
