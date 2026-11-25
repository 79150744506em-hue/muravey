import * as Y from 'yjs';
import type {EntityDocument, EntityKind} from './types';

export const documentKey = (kind: EntityKind, ownerId: string, id: string) => `${kind}:${ownerId}:${id}`;

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function encode(value: unknown): unknown {
    if (typeof value === 'string') return new Y.Text(value);
    if (Array.isArray(value)) {
        const array = new Y.Array<unknown>();
        array.push(value.map(encode));
        return array;
    }
    if (isObject(value)) {
        const map = new Y.Map<unknown>();
        for (const [key, item] of Object.entries(value)) {
            if (item !== undefined) map.set(key, encode(item));
        }
        return map;
    }
    return value ?? null;
}

export function valueToJson(value: unknown): unknown {
    if (value instanceof Y.Text) return value.toString();
    if (value instanceof Y.Array) return value.toArray().map(valueToJson);
    if (value instanceof Y.Map) {
        const result: JsonObject = {};
        value.forEach((item, key) => {
            result[key] = valueToJson(item);
        });
        return result;
    }
    return value;
}

export function docToEntity<T>(doc: Y.Doc): T {
    return valueToJson(doc.getMap('entity').get('root')) as T;
}

function updateText(text: Y.Text, next: string) {
    const current = text.toString();
    if (current === next) return;
    let start = 0;
    while (start < current.length && start < next.length && current[start] === next[start]) start++;
    let currentEnd = current.length;
    let nextEnd = next.length;
    while (currentEnd > start && nextEnd > start && current[currentEnd - 1] === next[nextEnd - 1]) {
        currentEnd--;
        nextEnd--;
    }
    if (currentEnd > start) text.delete(start, currentEnd - start);
    if (nextEnd > start) text.insert(start, next.slice(start, nextEnd));
}

const itemKey = (value: unknown): string | null => {
    if (isObject(value) && typeof value.id === 'string') return `id:${value.id}`;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return `value:${JSON.stringify(value)}`;
    return null;
};

function updateArray(array: Y.Array<unknown>, next: unknown[]) {
    const identifiable = next.every((item) => itemKey(item) !== null);
    if (!identifiable) {
        if (JSON.stringify(valueToJson(array)) === JSON.stringify(next)) return;
        if (array.length) array.delete(0, array.length);
        if (next.length) array.insert(0, next.map(encode));
        return;
    }

    const wanted = new Set(next.map(itemKey));
    for (let i = array.length - 1; i >= 0; i--) {
        if (!wanted.has(itemKey(valueToJson(array.get(i))))) array.delete(i, 1);
    }
    for (let i = 0; i < next.length; i++) {
        const nextItem = next[i];
        const key = itemKey(nextItem);
        const current = array.get(i);
        if (itemKey(valueToJson(current)) === key) {
            updateInPlace(array, i, current, nextItem);
            continue;
        }
        let found = -1;
        for (let j = i + 1; j < array.length; j++) {
            if (itemKey(valueToJson(array.get(j))) === key) {
                found = j;
                break;
            }
        }
        const item = found >= 0 ? array.get(found) : encode(nextItem);
        if (found >= 0) array.delete(found, 1);
        array.insert(i, [item]);
        if (found < 0) continue;
        updateInPlace(array, i, item, nextItem);
    }
    if (array.length > next.length) array.delete(next.length, array.length - next.length);
}

function updateInPlace(parent: Y.Map<unknown> | Y.Array<unknown>, key: string | number, current: unknown, next: unknown) {
    if (typeof next === 'string' && current instanceof Y.Text) {
        updateText(current, next);
        return;
    }
    if (Array.isArray(next) && current instanceof Y.Array) {
        updateArray(current, next);
        return;
    }
    if (isObject(next) && current instanceof Y.Map) {
        updateMap(current, next);
        return;
    }
    if (Object.is(current, next)) return;
    const encoded = encode(next);
    if (parent instanceof Y.Map) parent.set(String(key), encoded);
    else {
        parent.delete(Number(key), 1);
        parent.insert(Number(key), [encoded]);
    }
}

function updateMap(map: Y.Map<unknown>, next: JsonObject) {
    for (const key of [...map.keys()]) {
        if (!Object.prototype.hasOwnProperty.call(next, key) || next[key] === undefined) map.delete(key);
    }
    for (const [key, value] of Object.entries(next)) {
        if (value === undefined) continue;
        if (map.has(key)) updateInPlace(map, key, map.get(key), value);
        else map.set(key, encode(value));
    }
}

export function createEntityDoc<T extends JsonObject>(entity: T): Y.Doc {
    const doc = new Y.Doc();
    doc.transact(() => {
        doc.getMap('entity').set('root', encode(entity));
    }, 'remote');
    return doc;
}

export function applyEntity<T extends JsonObject>(doc: Y.Doc, entity: T, origin: unknown = 'local') {
    doc.transact(() => {
        const root = doc.getMap('entity');
        if (!(root.get('root') instanceof Y.Map)) root.set('root', encode(entity));
        else updateMap(root.get('root') as Y.Map<unknown>, entity);
    }, origin);
}

export function entityFromDocument<T>(document: EntityDocument & {state: string}): T {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, base64ToBytes(document.state), 'remote');
    return docToEntity<T>(doc);
}
