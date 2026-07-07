/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX } from 'solid-js';
import { splitProps, onCleanup, onMount } from 'solid-js';
import { cx } from '@/lib/cva';

export function ControlScrollArea(props: JSX.IntrinsicElements['div']) {
  const [local, others] = splitProps(props, ['class', 'children']);
  let scrollEl: HTMLDivElement | undefined;
  let borderEl: HTMLDivElement | undefined;

  const onScroll = () => {
    if (!scrollEl || !borderEl) return;
    borderEl.classList.toggle('hidden', scrollEl.scrollTop <= 0);
  };

  onMount(() => {
    scrollEl?.addEventListener('scroll', onScroll);
  });
  onCleanup(() => scrollEl?.removeEventListener('scroll', onScroll));

  return (
    <div class={cx('relative', local.class)} {...others}>
      <div
        ref={scrollEl}
        class="overflow-y-auto overflow-x-hidden absolute inset-0"
      >
        {local.children}
      </div>
      <div
        ref={borderEl}
        class="hidden absolute left-0 right-0 top-0 h-px bg-border"
      />
    </div>
  );
}

