/**
 * SkillMarketSettings — 技能市场。
 * 改为「精选技能 / 提示词库」双 Tab，去掉外部 Hub（ClawHub/LoopHub/SkillHub）榜单同步，
 * 直接内置 GeekClaw 精选技能（后端 builtin-skills 素材化，开箱即用）与中文提示词库。
 */
import { useCallback, useState } from 'react';
import { Button, Message, Tag } from '@arco-design/web-react';
import { Flashlight, FileText, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useGeekClawQuickStart } from '@/renderer/hooks/agent/useGeekClawQuickStart';
import { FEATURED_SKILLS, type FeaturedSkill } from '@/renderer/data/featuredSkills';
import PromptLibrary from './PromptLibrary';

type Tab = 'featured' | 'prompts';

const CARD_GRID_COLS = 'repeat(auto-fill, minmax(min(232px, 100%), 1fr))';

const FeaturedSkillCard: React.FC<{ skill: FeaturedSkill; onUse: (s: FeaturedSkill) => void }> = ({
  skill,
  onUse,
}) => (
  <div className='group relative flex flex-col rounded-16px border border-solid p-14px transition-all duration-180 border-[var(--color-border-2)] bg-[var(--color-bg-2)] hover:border-[var(--color-primary-light-4)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]'>
    <Button
      size='mini'
      type='primary'
      className='!absolute !right-12px !top-12px !rounded-[100px] !h-26px !px-10px !text-12px'
      icon={<Plus theme='outline' size={12} strokeWidth={3} />}
      onClick={() => onUse(skill)}
    >
      使用
    </Button>
    <div className='flex items-start gap-10px pr-64px'>
      <div className='flex-shrink-0 w-36px h-36px rounded-10px flex items-center justify-center font-bold text-13px shadow-sm bg-primary-1 text-primary-6'>
        {skill.cat.charAt(0)}
      </div>
      <div className='min-w-0 flex-1 pt-2px'>
        <div className='flex items-center gap-6px min-w-0 flex-wrap'>
          <span className='truncate max-w-full text-14px font-medium leading-20px text-[var(--color-text-1)]' title={skill.name}>
            {skill.title}
          </span>
          <Tag size='small' bordered={false} className='!bg-primary-1 !text-primary-6 !rounded-6px !text-10px !flex-shrink-0'>
            {skill.cat}
          </Tag>
        </div>
      </div>
    </div>
    <div
      className='mt-10px text-12px leading-18px text-[var(--color-text-3)] min-h-[36px]'
      title={skill.description}
      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
    >
      {skill.description || '暂无描述。'}
    </div>
  </div>
);

const SkillMarketSettings: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('featured');
  const { start } = useGeekClawQuickStart();

  const handleUse = useCallback(
    async (skill: FeaturedSkill) => {
      const ok = await start({
        name: `使用技能 ${skill.title}`,
        prompt: `请使用 GeekClaw 内置技能「${skill.title}」来完成我的需求。\n\n技能说明：${skill.description}\n\n我的具体需求：`,
        send: false,
      });
      if (!ok) Message.warning(t('settings.skillsMarket.noModel', { defaultValue: '请先在设置中配置模型后再使用技能。' }));
    },
    [start, t]
  );

  return (
    <div className='flex flex-col h-full w-full'>
      <div className='space-y-16px pb-24px'>
        <div className='flex flex-col gap-10px'>
          <h2 className='m-0 text-28px font-700 leading-[1.1] text-t-primary'>
            {t('settings.skillsMarket.title', { defaultValue: '技能市场' })}
          </h2>
          <p className='mt-4px mb-0 max-w-[720px] text-14px text-t-secondary leading-relaxed'>
            {t('settings.skillsMarket.description', {
              defaultValue: 'GeekClaw 精选内置技能已开箱即用；另有 1900+ 中文提示词库，可搜索并一键复制。',
            })}
          </p>
        </div>

        <div className='inline-flex items-center gap-4px rounded-12px bg-[var(--color-bg-2)] p-3px border border-solid border-[var(--color-border-2)] w-fit'>
          <Button
            size='small'
            type={tab === 'featured' ? 'primary' : 'text'}
            className='!rounded-9px !h-30px !px-14px !text-13px'
            icon={<Flashlight size={14} />}
            onClick={() => setTab('featured')}
          >
            {t('settings.skillsMarket.tabFeatured', { defaultValue: '精选技能' })}
            <span className='ml-4px opacity-70'>{FEATURED_SKILLS.length}</span>
          </Button>
          <Button
            size='small'
            type={tab === 'prompts' ? 'primary' : 'text'}
            className='!rounded-9px !h-30px !px-14px !text-13px'
            icon={<FileText size={14} />}
            onClick={() => setTab('prompts')}
          >
            {t('settings.skillsMarket.tabPrompts', { defaultValue: '提示词库' })}
          </Button>
        </div>

        {tab === 'featured' ? (
          <div className='grid gap-12px' style={{ gridTemplateColumns: CARD_GRID_COLS }}>
            {FEATURED_SKILLS.map((skill) => (
              <FeaturedSkillCard key={skill.id} skill={skill} onUse={handleUse} />
            ))}
          </div>
        ) : (
          <PromptLibrary />
        )}
      </div>
    </div>
  );
};

export default SkillMarketSettings;
