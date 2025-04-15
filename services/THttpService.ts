import { IBaseServiceEnv, IBindingEnv, TBaseService } from "./TBaseService";
import * as testSettings from "./HttpServiceTestSettings.json";

export const SUB_REQUEST_HEADERS_ARRAY = [
  "cf-connecting-ip",
  "cf-ipcountry",
  "x-real-ip",
  "x-requested-with",
  "user-agent",
  "f2x_request_id", 
  "f2x_hmac",
  "f2x_user_agent"
];

export interface IHttpServiceEnv extends IBaseServiceEnv {
  q_access: Queue<any>;
  // std_analytics: AnalyticsEngineDataset
}

export type TRequestHttpParams = {
  url: string;
  method: string;
  ip: string;
  body: string;
  headers: {[key:string]:string};
};

export type TRequestUrlPattern = {
  id: string;
  descr: string;
  pathname: string;
  search?:string;
  method: string;
  func: Function;
  category? : string;
  test?: {};
};

export abstract class THttpService extends TBaseService {
  protected requestHttpParams = {} as TRequestHttpParams;
  private _requestUrlPatterns: Array<TRequestUrlPattern> =
    {} as Array<TRequestUrlPattern>;
  protected readonly q_access: Queue<any>;
  abstract initMaskedArray()
  protected varsEnvArray: Array<string>;
  protected type: string;

  constructor(env: IHttpServiceEnv, name: string, version: string, type?: string) {
    super(env, name, version);
    this.q_access = env.q_access;
    this.requestUrlPatterns = [] as Array<TRequestUrlPattern>;
    if(type) {
      this.type = type;
    }
  }

  async callHttp(
    url: string,
    method: string,
    params?: BodyInit,
    headers?: {},
    cf?: RequestInitCfProperties
  ) {
    let filteredHeaders = Object.entries(this.requestHttpParams.headers).filter(
      (head) => {
        if (SUB_REQUEST_HEADERS_ARRAY.includes(head[0])) {
          return head;
        }
      }
    );
    let newHeaders = this.requestHttpParams.ip?.length ? Object.assign({"X-Forwarded-For": this.requestHttpParams.ip}, Object.fromEntries(filteredHeaders), headers) : Object.assign({}, Object.fromEntries(filteredHeaders), headers);
    return await super.callHttp(url, method, params, newHeaders, cf);
  }

  async callService(
    env: IBaseServiceEnv,
    name: keyof IBindingEnv,
    url: string,
    method: string,
    params?: BodyInit,
    headers?: {}
  ): Promise<any> {
    let filteredHeaders = Object.entries(this.requestHttpParams.headers).filter(
      (head) => {
        if (SUB_REQUEST_HEADERS_ARRAY.includes(head[0])) {
          return head;
        }
      }
    );
    let newHeaders = Object.assign({}, headers, Object.fromEntries(filteredHeaders));
    return await super.callService(env, name, url, method, params, newHeaders);
  }

  get requestUrlPatterns(): Array<TRequestUrlPattern> {
    return this._requestUrlPatterns;
  }
  set requestUrlPatterns(patterns: Array<TRequestUrlPattern>) {
    this._requestUrlPatterns = [
      ...patterns,
      ...[
        {
          id: "all_requests_id",
          descr: "Получение описания поддерживаемых запросов",
          pathname: "/std/requests",
          method: "get",
          func: this.getAllRequests,
          test: testSettings["all_requests_id"],
        },
        {
          id: "request_params_id",
          descr: "Получение параметров запроса",
          pathname: "/std/requests/:req_id",
          method: "get",
          func: this.type === "refactored" ? this.getHttpRequestParams : this.getRequestParams,
          test: testSettings["request_params_id"],
        },
      ],
    ];
  }

  async init(request: Request) {
    const requestClone = request.clone();
    this.requestHttpParams = {
      method: request.method.toLowerCase(),
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: await requestClone.text(),
      ip: request.headers.get("cf-connecting-ip")
        ? request.headers.get("cf-connecting-ip")
        : "",
    };

    if (request.headers.get("f2x_request_id")) {
      this.id = request.headers.get("f2x_request_id")!;
    }
    if (
      request.headers.get("f2x_trace") &&
      Number(request.headers.get("f2x_trace")) > this.trace
    ) {
      this.trace = request.headers.get("f2x_trace")!;
    }

    this.initMaskedArray();

    if (this.trace) {
      let message = await this.getTraceMessageHttpRequest(request);
      await this.traceMessage(message, "service_in");
    }
  }

  protected async getAllRequests(env: IHttpServiceEnv) {
    let res = this.requestUrlPatterns.map((item) => {
      return {
        id: item.id,
        name: this.name,
        descr: item.descr,
        url: item.search ? `https://${this.name}${item.pathname}?${item.search}` : `https://${this.name}${item.pathname}`,
        method: item.method,
        category: item?.category
      };
    });
    let vars = {
      TRACE: env.TRACE,
      LOG: env.TRACE,
      EXCEPTION: env.EXCEPTION,
      INSTANCE: env.INSTANCE,
      VERSION: this.version
    }

    if (this.varsEnvArray) {
      for (let v of this.varsEnvArray) {
        vars[v] = env[v];
      }
    }

    let result = {
      responseStatus: 200,
      responseError: [],
      responseResult: {
        vars: vars,
        params: res,
      },
    };
    return result;
  }

  protected getRequestParams(
    env: IHttpServiceEnv,
    pattern: TRequestUrlPattern,
    requestHttpParams: TRequestHttpParams
  ) {
    let urlPattern = new URLPattern({ pathname: pattern.pathname });
    let req_id = urlPattern.exec(requestHttpParams.url)!.pathname.groups.req_id;
    let request = this.requestUrlPatterns.find((item) => item.id === req_id);
    if (request) {
      let result = {
        responseStatus: 200,
        responseError: [],
        responseResult: {
          name: this.name,
          id: request.id,
          descr: request.descr,
          url: request.search ? `https://${this.name}${request.pathname}?${request.search}` : `https://${this.name}${request.pathname}`,
          method: request.method,
          test: request.test,
        },
      };

      return result;
    }
  }

  protected getHttpRequestParams(
    env: IHttpServiceEnv,
    srv: THttpService,
    pattern: TRequestUrlPattern,
    requestHttpParams: TRequestHttpParams
  ) {
    let urlPattern = new URLPattern({ pathname: pattern.pathname });
    let req_id = urlPattern.exec(requestHttpParams.url)!.pathname.groups.req_id;
    let request = this.requestUrlPatterns.find((item) => item.id === req_id);
    if (request) {
      let result = {
        responseStatus: 200,
        responseError: [],
        responseResult: {
          name: this.name,
          id: request.id,
          descr: request.descr,
          url: request.search ? `https://${this.name}${request.pathname}?${request.search}` : `https://${this.name}${request.pathname}`,
          method: request.method,
          test: request.test,
        },
      };

      return result;
    }
  }

  protected async logAccess(
    requestUrl: string,
    requestMethod: string,
    statusCode: number,
    ip: string,
    isError: "1" | "0"
  ) {
    let result = this.maskInfo(
      JSON.stringify({
        serviceName: this.name,
        time: new Date(Date.now()).toISOString(),
        requestUrl: requestUrl,
        requestMethod: requestMethod,
        statusCode: statusCode,
        ip: ip,
        isError: isError,
      })
    );
    await this.q_access.send(JSON.parse(result));
  }

  async handleUrlRequest(env: IHttpServiceEnv) {
    try {
      for (let pattern of this.requestUrlPatterns) {
        let patternParam: {
          pathname: string;
          search?: string;
        } = { pathname: pattern.pathname };

        if (pattern.search) {
          patternParam.search = pattern.search;
        }
        let urlPattern = new URLPattern(patternParam);
        if (
          !urlPattern.test(this.requestHttpParams.url) ||
          this.requestHttpParams.method !== pattern.method
        )
          continue;

        let result;
        try {
          result = await pattern.func.call(
            this,
            env,
            pattern,
            this.requestHttpParams
          );
          //analytics
          // try {
          //   env.std_analytics.writeDataPoint({
          //     blobs: [
          //       result.responseStatus === 200 ? 0 : 1,
          //       result.responseStatus,
          //       new URL(this.requestHttpParams.url)?.pathname,
          //       pattern.id,
          //     ],
          //     indexes: [this.name],
          //   });
          // } catch (e) {}
        } catch (error: any) {
          let exceptionMessage = await this.getExceptionMessage.call(
            this,
            error,
            this.requestHttpParams.url,
            this.requestHttpParams.body
          );
          return await this.generateResponseError(
            400,
            "VERIFICATION_FAILED",
            "Bad params",
            exceptionMessage
          );
        }

        if (
          result?.responseError &&
          Object.keys(result?.responseError).length
        ) {
          return await this.generateResponseError(
            result.responseStatus,
            result.responseError?.errorCode
              ? result.responseError?.errorCode
              : `API_ERROR`,
            result.responseError?.errorText
              ? result.responseError?.errorText
              : `Error on ${this.requestHttpParams.url}`,
            result.responseError?.errorTrace
              ? result.responseError?.errorTrace
              : null,
            result.responseError?.errorData
              ? result.responseError?.errorData
              : null
          );
        }

        if (result?.responseResult) {
          return await this.generateResponseOK(
            JSON.stringify(result.responseResult, null, 2),
            result.responseStatus
          );
        }
      }

      return await this.generateResponseError(
        404,
        `NOT_FOUND`,
        "Data not found",
        null
      );
    } catch (error: any) {
      let exceptionMessage = await this.getExceptionMessage.call(
        this,
        error,
        this.requestHttpParams.url,
        this.requestHttpParams.body
      );
      return await this.generateResponseError(
        400,
        "VERIFICATION_FAILED",
        "Bad params",
        exceptionMessage
      );
    }
  }

  async handleHttpRequest(env: IHttpServiceEnv) {
    try {
      for (let pattern of this.requestUrlPatterns) {
        let patternParam: {
          pathname: string;
          search?: string;
        } = { pathname: pattern.pathname };

        if (pattern.search) {
          patternParam.search = pattern.search;
        }
        let urlPattern = new URLPattern(patternParam);
        if (
          !urlPattern.test(this.requestHttpParams.url) ||
          this.requestHttpParams.method !== pattern.method
        )
          continue;

        let result;
        try {
          result = await pattern.func.call(
            this,
            env,
            this,
            pattern,
            this.requestHttpParams
          );
        } catch (error: any) {
          let exceptionMessage = await this.getExceptionMessage.call(
            this,
            error,
            this.requestHttpParams.url,
            this.requestHttpParams.body
          );
          return await this.generateResponseError(
            400,
            "VERIFICATION_FAILED",
            "Bad params",
            exceptionMessage
          );
        }

        if (
          result?.responseError &&
          Object.keys(result?.responseError).length
        ) {
          return await this.generateResponseError(
            result.responseStatus,
            result.responseError?.errorCode
              ? result.responseError?.errorCode
              : `API_ERROR`,
            result.responseError?.errorText
              ? result.responseError?.errorText
              : `Error on ${this.requestHttpParams.url}`,
            result.responseError?.errorTrace
              ? result.responseError?.errorTrace
              : null,
            result.responseError?.errorData
              ? result.responseError?.errorData
              : null
          );
        }

        if (result?.responseResult) {
          return await this.generateResponseOK(
            JSON.stringify(result.responseResult, null, 2),
            result.responseStatus
          );
        }
      }

      return await this.generateResponseError(
        404,
        `NOT_FOUND`,
        "Data not found",
        null
      );
    } catch (error: any) {
      let exceptionMessage = await this.getExceptionMessage.call(
        this,
        error,
        this.requestHttpParams.url,
        this.requestHttpParams.body
      );
      return await this.generateResponseError(
        400,
        "VERIFICATION_FAILED",
        "Bad params",
        exceptionMessage
      );
    }
  }

  async generateResponseError(
    statusCode: number,
    errorCode: string,
    errorText: string,
    errorTrace: any,
    data?: any
  ) {
    let error: {
      code: string;
      message: string;
      data?: {
        identityTypes: Array<{ name: string; isEnabled: boolean }>;
        state: string;
      };
      trace: null | string;
    } = {
      code: errorCode,
      message: errorText,
      trace: errorTrace,
    };
    if (data) {
      error.data = data;
    }

    let response = new Response(JSON.stringify(error, null, 2), {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (this.trace) {
      let message = await this.getTraceMessageHttpResponse(response);
      await this.traceMessage(message, "service_out", error);
    }
    if (this.log === "error" || this.log === "all") {
      await this.logAccess(
        this.requestHttpParams.url,
        this.requestHttpParams.method,
        response.status,
        this.requestHttpParams.ip,
        "1"
      );
    }

    return response;
  }

  async generateResponseOK(
    resp: string,
    status: number,
    additionalHeaders?: {}
  ) {
    let headers = {
      "Content-Type": "application/json",
    };
    if (additionalHeaders) {
      headers = Object.assign(headers, additionalHeaders);
    }
    let response = new Response(resp, {
      status: status,
      headers: headers,
    });

    if (this.trace) {
      let message = await this.getTraceMessageHttpResponse(response);
      await this.traceMessage(message, "service_out");
    }

    if (this.log === "all") {
      await this.logAccess(
        this.requestHttpParams.url,
        this.requestHttpParams.method,
        response.status,
        this.requestHttpParams.ip,
        "0"
      );
    }

    return response;
  }
}
