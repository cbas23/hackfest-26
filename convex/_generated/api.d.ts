/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as airQuality from "../airQuality.js";
import type * as blackouts from "../blackouts.js";
import type * as blockedTunnels from "../blockedTunnels.js";
import type * as events from "../events.js";
import type * as model from "../model.js";
import type * as sickness from "../sickness.js";
import type * as waterCuts from "../waterCuts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  airQuality: typeof airQuality;
  blackouts: typeof blackouts;
  blockedTunnels: typeof blockedTunnels;
  events: typeof events;
  model: typeof model;
  sickness: typeof sickness;
  waterCuts: typeof waterCuts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
