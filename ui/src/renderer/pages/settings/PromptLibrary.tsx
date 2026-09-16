/**
 * PromptLibrary — 内置中文提示词库（1916 条），可搜索、按场景筛选、一键复制。
 * 纯前端数据源：src/renderer/data/promptLibrary.json
 */
import { useMemo, useState } from 'react';
import { Button, Input, Message, Tag } from '@arco-design/web-react';
import { Copy, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import promptData from '@/renderer/data/promptLibrary.json';

type PromptItem = { cat: string; index: number; title: string; content: string };

const ALL_CATS = Array.from(new Set((promptData.items as PromptItem[]).map((p) => p.cat)));

const PromptLibrary: React.FC = () => {
  const { t } = useTranslation();
  const [cat, setCat] = useState<string>('全部');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (promptData.items as PromptItem[]).filter((p) => {
      if (cat !== '全部' && p.cat !== cat) return false;
      if (q && !`${p.title} ${p.content}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cat, query]);

  const handleCopy = async (p: PromptItem) => {
    try {
      await navigator.clipboard.writeText(p.content);
      setCopied(`${p.cat}-${p.index}`);
      Message.success(t('settings.promptLibrary.copied', { defaultValue: '已复制提示词' }));
      setTimeout(() => setCopied((c) => (c === `${p.cat}-${p.index}` ? null : c)), 1500);
    } catch {
      Message.error(t('settings.promptLibrary.copyFailed', { defaultValue: '复制失败，请手动选择' }));
    }
  };

  return (
    <div className='flex flex-col gap-14px'>
      <div className='flex flex-wrap items-center gap-10px'>
        <div className='inline-flex items-center gap-4px rounded-12px bg-[var(--color-bg-2)] p-3px border border-solid border-[var(--color-border-2)] flex-wrap'>
          {['全部', ...ALL_CATS].map((c) => (
            <Button
              key={c}
              size='small'
              type={cat === c ? 'primary' : 'text'}
              className='!rounded-9px !h-28px !px-12px !text-12px'
              onClick={() => setCat(c)}
            >
              {c}
            </Button>
          ))}
        </div>
        <Input
          allowClear
          value={query}
          className='!bg-[var(--color-bg-2)] !w-220px'
          placeholder={t('settings.promptLibrary.search', { defaultValue: '搜索提示词…' })}
          prefix={<Search size={14} fill='currentColor' />}
          onChange={setQuery}
        />
        <span className='text-12px text-t-tertiary'>
          {t('settings.promptLibrary.count', { defaultValue: `共 ${filtered.length} 条` })}
        </span>
      </div>

      <div className='grid gap-10px max-h-[58vh] overflow-auto pr-4px' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))' }}>
        {filtered.map((p) => (
          <div
            key={`${p.cat}-${p.index}`}
            className='flex flex-col rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'
          >
            <div className='flex items-center justify-between gap-8px mb-6px'>
              <div className='flex items-center gap-6px min-w-0'>
                <Tag size='small' bordered={false} className='!bg-primary-1 !text-primary-6 !rounded-6px !text-10px !flex-shrink-0'>
                  {p.cat}
                </Tag>
                <span className='truncate text-13px font-medium text-t-primary' title={p.title}>
                  {p.title}
                </span>
              </div>
              <Button
                size='mini'
                type='primary'
                className='!rounded-[100px] !h-24px !px-8px !text-11px !flex-shrink-0'
                icon={<Copy theme='outline' size={12} />}
                onClick={() => void handleCopy(p)}
              >
                {copied === `${p.cat}-${p.index}`
                  ? t('settings.promptLibrary.copiedShort', { defaultValue: '已复制' })
                  : t('settings.promptLibrary.copy', { defaultValue: '复制' })}
              </Button>
            </div>
            <p className='m-0 text-12px leading-18px text-t-secondary whitespace-pre-wrap break-words'>
              {p.content}
            </p>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className='text-center text-t-secondary py-30px col-span-full'>
            {t('settings.promptLibrary.empty', { defaultValue: '没有匹配的提示词。' })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PromptLibrary;
