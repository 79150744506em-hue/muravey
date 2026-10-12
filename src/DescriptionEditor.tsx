import React from 'react';
import {MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';
import type {ToolbarsPreset} from '@gravity-ui/markdown-editor';
import {
    ActionName as Action,
    ToolbarName as Toolbar,
} from '@gravity-ui/markdown-editor/_/modules/toolbars/constants.js';
import {yfm} from '@gravity-ui/markdown-editor/_/modules/toolbars/presets.js';

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
}: {
    value: string;
    onChange: (markdown: string) => void;
    onSubmit?: () => void;
    placeholder?: string;
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

    React.useEffect(() => {
        const change = () => onChangeRef.current(editor.getValue());
        const submit = () => onSubmitRef.current?.();
        editor.on('change', change);
        editor.on('submit', submit);
        return () => {
            editor.off('change', change);
            editor.off('submit', submit);
        };
    }, [editor]);

    return (
        <div className="mv-desc">
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
