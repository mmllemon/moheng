/**
 * 预览空态选择器 —— 逐字对齐 hana 的 zq（CardShell-DVSoA_HL.js）。
 *
 * hana 原式（type === 'new-tab' 时渲染）：
 *   <div className={Nd.root} data-preview-new-tab-chooser data-dragging onDragEnter onDragOver
 *        onDragLeave onDrop>
 *     <div className={Nd.actions}>
 *       <Btn variant="secondary" size="lg" className={Nd.entry} iconLeft={<FileIcon size={20} />}
 *            onClick={openFile} data-preview-new-tab-open-file>
 *         <span className={Nd.entryLabel}>打开文件</span>
 *       </Btn>
 *       {canOpenWebsite && <Btn ...>打开网站</Btn>}
 *     </div>
 *     <input ref type="file" multiple hidden onChange={onFiles} />
 *   </div>
 *
 * CSS 真值（CardShell-B3PSoerL.css）：
 *   ._root_aaf29       display:grid; place-items:center; min-height:100%; box-sizing:border-box;
 *                      padding:--space-24; padding-bottom:calc(--space-24 + --space-40); text-align:center
 *   ._actions_f7aad    display:flex; flex-direction:column; gap:--space-16; width:min(100%,16rem); min-width:0
 *   ._entry_b9036      width:100%
 *   ._entryLabel_cf0a5 color:--text-muted
 *   按钮 secondary+lg   padding:.55rem 1.4rem; font-size:--fs-body; background:--overlay-subtle
 *   图标               Lucide "file"，size 20
 *
 * 注：按需求去掉「打开网站」，只保留「打开文件」与拖放。
 */

import { File } from 'lucide-react';
import { useRef, useState } from 'react';

type Props = {
  /** 选中文件后回调 */
  onPickFiles: (files: FileList) => void;
  /** 拖入文件后回调（与点击等价，走同一入口） */
  hint?: string;
};

export function PreviewNewTabChooser({ onPickFiles, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  /** 用计数器抵消子元素 dragleave 抖动（对齐 hana 的 dragActive 语义） */
  const depth = useRef(0);

  return (
    <div
      className="preview-new-tab"
      data-preview-new-tab-chooser
      data-dragging={dragging ? 'true' : undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        if (depth.current === 1) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) onPickFiles(files);
      }}
    >
      <div className="preview-new-tab-actions">
        <button
          type="button"
          className="preview-new-tab-entry"
          data-preview-new-tab-open-file
          onClick={() => inputRef.current?.click()}
        >
          <File size={20} />
          <span className="preview-new-tab-entry-label">打开文件</span>
        </button>
        {hint && <span className="preview-new-tab-hint">{hint}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        data-testid="preview-new-tab-file-input"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) onPickFiles(files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
