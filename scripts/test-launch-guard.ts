import { apiMustBeBlocked } from '../lib/launch-guard.ts';
if (!apiMustBeBlocked('production')) throw new Error('Production API must be blocked');
if (apiMustBeBlocked('development') || apiMustBeBlocked('test')) throw new Error('Demo and tests should remain usable');
console.log('Production API заблокирован; локальный режим доступен');
