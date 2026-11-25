import React from 'react';
import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';
import type {ToolbarsPreset} from '@gravity-ui/markdown-editor';
import {
    ActionName as Action,
    ToolbarName as Toolbar,
} from '@gravity-ui/markdown-editor/_/modules/toolbars/constants.js';
import {yfm} from '@gravity-ui/markdown-editor/_/modules/toolbars/presets.js';
import MarkdownIt from 'markdown-it';
import ins from 'markdown-it-ins';

const readonlyMarkdown = new MarkdownIt({html: false, linkify: true, breaks: true}).use(ins);

// только то, что нужно в описании задачи
const MARKS = [Action.bold, Action.italic, Action.strike, Action.underline];
const ITEMS = [...MARKS, Action.link, Action.codeInline, Action.orderedList, Action.bulletList];

const toolbar: ToolbarsPreset = {
    items: Object.fromEntries(ITEMS.map((id) => [id, yfm.items[id]])),
    orders: {
        [Toolbar.wysiwygMain]: [MARKS, [Action.link, Action.codeInline], [Action.orderedList, Action.bulletList]],
        [Toolbar.wysiwygHidden]: [],
        [Toolbar.markupMain]: [],
        [Toolbar.markupHidden]: [],
        [Toolbar.wysiwygSelection]: [MARKS, [Action.link, Action.codeInline]],
        [Toolbar.wysiwygSlash]: [],
    },
};

export function DescriptionEditor({
    value,
    onChange,
    onSubmit,
    placeholder,
    readOnly = false,
}: {
    value: string;
    onChange: (markdown: string) => void;
    onSubmit?: () => void;
    placeholder?: string;
    readOnly?: boolean;
}) {
    const editor = useMarkdownEditor({
        preset: 'yfm',
        md: {html: false, breaks: true, linkify: true},
        initial: {markup: value, mode: 'wysiwyg', toolbarVisible: true},
        wysiwygConfig: {placeholderOptions: {value: placeholder}},
    });

    const onChangeRef = React.useRef(onChange);
    onChangeRef.current = onChange;
    const onSubmitRef = React.useRef(onSubmit);
    onSubmitRef.current = onSubmit;
    const valueRef = React.useRef(value);
    valueRef.current = value;
    const dirty = React.useRef(false);
    const root = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const change = () => {
            dirty.current = true;
            onChangeRef.current(editor.getValue());
        };
        const submit = () => onSubmitRef.current?.();
        editor.on('change', change);
        editor.on('submit', submit);
        return () => {
            editor.off('change', change);
            editor.off('submit', submit);
        };
    }, [editor]);

    React.useEffect(() => {
        if (value === editor.getValue()) {
            dirty.current = false;
            return;
        }
        if (!dirty.current) editor.replace(value);
    }, [editor, value]);

    if (readOnly) {
        return (
            <div className="mv-desc mv-desc_readonly mv-desc_preview">
                <div className="mv-md" dangerouslySetInnerHTML={{__html: readonlyMarkdown.render(value)}} />
            </div>
        );
    }

    return (
        <div
            ref={root}
            className={`mv-desc${readOnly ? ' mv-desc_readonly' : ''}`}
            onBlurCapture={() => {
                if (readOnly) return;
                onSubmitRef.current?.();
                window.setTimeout(() => {
                    dirty.current = false;
                    if (valueRef.current !== editor.getValue()) editor.replace(valueRef.current);
                });
            }}
        >
            <MarkdownEditorView
                editor={editor}
                toolbarsPreset={toolbar}
                settingsVisible={false}
                stickyToolbar={false}
                className="mv-desc__editor"
            />
        </div>
    );
}
