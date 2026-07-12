/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": USER_AGENT,
    };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    void request;
    void response;

    return data;
  }
}

// LNORI serves everything as long-cached static pages and never redirects within the read path
export async function fetchPage(url: string): Promise<string> {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`LNORI returned HTTP ${response.status} for ${url}`);
  }

  return Application.arrayBufferToUTF8String(data);
}
