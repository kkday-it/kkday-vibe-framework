"""Typed errors — workflow 拋這些,框架接手處理(失敗三件套);不要在 flow 內吞錯。"""


class WorkflowError(Exception):
    """所有框架 typed error 的基底。"""
    retryable = False


class TargetTimeout(WorkflowError):
    """目標系統逾時 — contract 可宣告 retry on 此類。"""
    retryable = True


class SubmittedUnknown(WorkflowError):
    """已送出但狀態不明 — 絕不自動重試(contract never_on)。"""
    retryable = False


class CheckpointRejected(WorkflowError):
    """互動模式:確認點未獲 --yes 放行。"""


class CheckpointNotApproved(WorkflowError):
    """worker 模式:多方參數/放行未補齊,fail fast(絕不 stdin 等待)。"""


class NotYetImplemented(WorkflowError):
    """介面已凍結、實作未到位(隨 kkday-connectors 補齊)。不要繞去自己 import 別的套件。"""
