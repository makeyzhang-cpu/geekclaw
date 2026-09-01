/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface ComingSoonProps {
  /** Optional subtitle shown under the main line. */
  title?: string;
}

/**
 * Generic placeholder surface for features that are intentionally disabled /
 * under construction. Keeps the visual language consistent with the rest of the
 * app (text-t-primary / text-t-tertiary on the standard surfaces).
 */
const ComingSoon: React.FC<ComingSoonProps> = ({ title }) => {
  return (
    <div className='flex flex-col items-center justify-center h-full w-full py-120px px-24px text-center'>
      <div className='text-40px font-700 text-t-tertiary mb-16px opacity-60'>🐾</div>
      <div className='text-18px font-600 text-t-primary mb-10px'>功能开发中，敬请期待</div>
      {title && <div className='text-13px text-t-tertiary'>{title}</div>}
    </div>
  );
};

export default ComingSoon;
