/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Spin } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useCsAgents } from './useCsAgents';
import CreateCsAgentModal from './CreateCsAgentModal';

/**
 * 客服首页（/customer-service）：不再显示花名册，而是直进第一个启用客服的
 * 坐席工作台。若没有任何客服，则显示创建引导。
 *
 * 花名册仍保留在 /customer-service/roster 作为管理后台。
 */
const CsHomePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, loading, refresh, create } = useCsAgents();
  const [createOpen, setCreateOpen] = useState(false);

  const targetAgent = useMemo(() => {
    if (!agents.length) return null;
    const enabled = agents.find((a) => a.enabled);
    return enabled ?? agents[0];
  }, [agents]);

  useEffect(() => {
    if (loading) return;
    if (targetAgent) {
      navigate(`/customer-service/${targetAgent.cs_agent_id}/workbench`, { replace: true });
    }
  }, [loading, targetAgent, navigate]);

  if (loading) {
    return (
      <div className='w-full h-full flex items-center justify-center'>
        <AppLoader />
      </div>
    );
  }

  if (targetAgent) {
    // 上面的 effect 会立即重定向；这里兜底防止闪屏。
    return (
      <div className='w-full h-full flex items-center justify-center'>
        <AppLoader />
      </div>
    );
  }

  return (
    <div className='w-full min-h-full box-border overflow-y-auto px-16px py-20px'>
      <div className='mx-auto flex w-full max-w-[680px] box-border flex-col gap-16px'>
        <Empty
          description={
            <div className='flex flex-col items-center gap-12px'>
              <span className='text-14px text-t-secondary'>
                {t('customerService.home.empty', {
                  defaultValue: '还没有客服员工，先创建一个才能进入工作台',
                })}
              </span>
              <Button type='primary' size='default' onClick={() => setCreateOpen(true)}>
                <span className='inline-flex items-center gap-6px'>
                  <Plus theme='outline' size='15' fill='currentColor' className='block' style={{ lineHeight: 0 }} />
                  {t('customerService.create.action', { defaultValue: '创建客服' })}
                </span>
              </Button>
            </div>
          }
        />
      </div>
      <CreateCsAgentModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(agent) => {
          void refresh().then(() => {
            navigate(`/customer-service/${agent.cs_agent_id}/workbench`, { replace: true });
          });
        }}
        create={create}
      />
    </div>
  );
};

export default CsHomePage;
