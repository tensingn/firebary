import {
	FieldPath,
	OrderByDirection,
	WhereFilterOp,
} from "@google-cloud/firestore";

export type QueryOptions<TField = string> = {
	whereOptions?: WhereOptions<TField>;
	orderOptions?: OrderOptions<TField>;
	pagingOptions?: PagingOptions<TField>;
};

export type WhereOptions<TField = string> = {
	whereClauses: WhereClause<TField>[];
	operator?: "and" | "or";
	pagingOptions: PagingOptions<string>;
};

export type OrderOptions<TField = string> = {
	field: string;
	direction: OrderByDirection;
	pagingOptions: PagingOptions<TField>;
};

export type PagingOptions<T = string> = {
	startAfter: T;
	limit: number;
};

export type WhereClause<TField = string> = {
	field: string | FieldPath;
	value: TField;
	operation: WhereFilterOp;
};

export const STANDARD: QueryOptions = {
	pagingOptions: {
		startAfter: null,
		limit: 10,
	},
};
