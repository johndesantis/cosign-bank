"use client";

import { useTideCloak } from "@/lib/tide/bridge";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  advanceLiveness,
  chooseLivenessDirection,
  createLivenessState,
  type LivenessObservation,
  type LivenessState,
} from "@/lib/liveness";
import { captureFaceEmbeddings } from "@/lib/face-embedding-client";

type Owner = { id: string; name: string; initials: string; sharePercent: number; device: string };
type Approval = {
  displayName: string;
  approvedAt: string;
  isCurrentUser: boolean;
  faceMatched?: boolean;
  faceSimilarity?: number;
};
type Withdrawal = {
  id: string;
  amountVnd: number;
  recipientName: string;
  recipientBank: string;
  accountLast4: string;
  requestedByDisplayName: string;
  status: "awaiting-app-approvals" | "application-approved" | "cancelled-face-mismatch" | "policy-deployment-required";
  approvalsRequired: 2;
  approvals: Approval[];
  createdAt: string;
  expiresAt: string;
  cancelledAt?: string;
  cancellationReason?: string;
  cancelledByDisplayName?: string;
  viewer: {
    isRequester: boolean;
    hasApproved: boolean;
  };
};
type AccountResponse = {
  account: {
    id: string;
    name: string;
    accountNumberMasked: string;
    balanceVnd: number;
    availableVnd: number;
    owners: Owner[];
  };
  recentActivity: Array<{
    id: string;
    label: string;
    counterparty: string;
    amountVnd: number;
    direction: "in" | "out";
    createdAt: string;
  }>;
  withdrawalRequests: Withdrawal[];
  session: {
    verifiedSubject: string;
    displayName: string;
  };
  faceProfile: {
    enrolled: boolean;
    enrolledAt: string | null;
    sampleCount: number;
    model: string;
  };
};

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });

function apiUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

function runWithoutMediaPipeInfoOverlay<T>(operation: () => T): T {
  const originalConsoleError = console.error;
  console.error = (...messages: unknown[]) => {
    const rendered = messages.map(String).join(" ");
    if (rendered.includes("Created TensorFlow Lite XNNPACK delegate for CPU")) return;
    originalConsoleError(...messages);
  };
  try {
    return operation();
  } finally {
    console.error = originalConsoleError;
  }
}

export default function DashboardPage() {
  const { getValueFromToken, logout, secureFetch, mode } = useTideCloak();
  const [data, setData] = useState<AccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraPurpose, setCameraPurpose] = useState<"enroll" | "approve" | null>(null);
  const [cameraWithdrawalId, setCameraWithdrawalId] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [livenessLoading, setLivenessLoading] = useState(false);
  const [liveness, setLiveness] = useState<LivenessState | null>(null);
  const [identityCapturing, setIdentityCapturing] = useState(false);
  const [identityCaptureProgress, setIdentityCaptureProgress] = useState(0);
  const [completionOpen, setCompletionOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const livenessRef = useRef<LivenessState | null>(null);
  const shownCompletionRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    amountVnd: "25000000",
    recipientName: "Duc Tran",
    recipientBank: "Demo Commercial Bank",
    accountLast4: "8831",
    reason: "Shared apartment deposit",
  });

  useEffect(() => {
    void loadAccount();
    const refreshTimer = window.setInterval(() => void loadAccount(false), 4_000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    let animationFrame = 0;
    let closeLandmarker: (() => void) | null = null;
    setCameraReady(false);
    setCameraError(null);
    setLivenessLoading(true);

    async function startLivenessCheck() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("This browser does not expose camera access.");
        setLivenessLoading(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(apiUrl("/mediapipe/wasm"));
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: apiUrl("/mediapipe/face_landmarker.task"),
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numFaces: 2,
          minFaceDetectionConfidence: 0.6,
          minFacePresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
          outputFaceBlendshapes: true,
        });
        closeLandmarker = () => landmarker.close();
        if (cancelled) {
          landmarker.close();
          return;
        }

        setCameraReady(true);
        setLivenessLoading(false);

        let lastInferenceAt = 0;
        function detectFrame(timestamp: number) {
          if (cancelled) return;
          const video = videoRef.current;
          if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            animationFrame = window.requestAnimationFrame(detectFrame);
            return;
          }

          if (timestamp - lastInferenceAt < 90) {
            animationFrame = window.requestAnimationFrame(detectFrame);
            return;
          }
          lastInferenceAt = timestamp;

          const result = runWithoutMediaPipeInfoOverlay(() =>
            landmarker.detectForVideo(video, timestamp),
          );
          const landmarks = result.faceLandmarks[0];
          const categories = result.faceBlendshapes[0]?.categories ?? [];
          const blendshape = (name: string) =>
            categories.find((category) => category.categoryName === name)?.score ?? 0;

          let displayNoseRatio: number | null = null;
          let faceWidth: number | null = null;
          if (landmarks?.[1]) {
            const xCoordinates = landmarks.map((landmark) => landmark.x);
            const minX = Math.min(...xCoordinates);
            const maxX = Math.max(...xCoordinates);
            faceWidth = maxX - minX;
            if (faceWidth > 0) {
              const rawNoseRatio = (landmarks[1].x - minX) / faceWidth;
              displayNoseRatio = 1 - rawNoseRatio;
            }
          }

          const observation: LivenessObservation = {
            atMs: Date.now(),
            faceCount: result.faceLandmarks.length,
            blinkLeft: blendshape("eyeBlinkLeft"),
            blinkRight: blendshape("eyeBlinkRight"),
            displayNoseRatio,
            faceWidth,
          };
          const current = livenessRef.current;
          if (!current) return;
          const next = advanceLiveness(current, observation);
          livenessRef.current = next;
          setLiveness(next);
          if (next.phase !== "passed" && next.phase !== "failed") {
            animationFrame = window.requestAnimationFrame(detectFrame);
          }
        }

        animationFrame = window.requestAnimationFrame(detectFrame);
      } catch {
        cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
        setCameraError("Camera or local face model could not start. Approval was not sent.");
        setLivenessLoading(false);
      }
    }

    void startLivenessCheck();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      closeLandmarker?.();
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, [cameraOpen]);

  useEffect(() => {
    const completed = data?.withdrawalRequests[0];
    if (
      completed?.status === "application-approved" &&
      shownCompletionRef.current !== completed.id
    ) {
      shownCompletionRef.current = completed.id;
      setCompletionOpen(true);
    }
  }, [data]);

  async function loadAccount(showLoading = true) {
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await secureFetch(apiUrl("/api/account"), { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 403) {
        throw new Error("Your Tide identity is verified, but the account:joint-owner role is not committed yet. Complete the 2-of-3 QEA approval, then sign out and sign in again.");
      }
      if (!response.ok) throw new Error(body.error || `Account request failed (${response.status})`);
      setData(body);
    } catch (caught) {
      if (showLoading) {
        setError(caught instanceof Error ? caught.message : "Could not load the joint account");
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function approveWithdrawal(withdrawalId: string, faceEmbeddings: number[][]) {
    setApproving(withdrawalId);
    setError(null);
    setNotice(null);
    try {
      const response = await secureFetch(apiUrl("/api/withdrawals"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdrawalId, faceEmbeddings }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Approval failed (${response.status})`);
      setNotice(body.notice);
      await loadAccount(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not approve the withdrawal request");
      await loadAccount(false);
    } finally {
      setApproving(null);
    }
  }

  function closeCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
    setCameraPurpose(null);
    setCameraWithdrawalId(null);
    setIdentityCapturing(false);
    setIdentityCaptureProgress(0);
  }

  function beginCameraCheck(purpose: "enroll" | "approve", withdrawalId: string | null = null) {
    const randomValue = new Uint32Array(1);
    window.crypto.getRandomValues(randomValue);
    const next = createLivenessState(chooseLivenessDirection(randomValue[0]));
    livenessRef.current = next;
    setLiveness(next);
    setCameraPurpose(purpose);
    setCameraWithdrawalId(withdrawalId);
    setCameraOpen(true);
  }

  function retryCameraCheck() {
    const purpose = cameraPurpose;
    const withdrawalId = cameraWithdrawalId;
    closeCamera();
    if (purpose) window.setTimeout(() => beginCameraCheck(purpose, withdrawalId), 100);
  }

  async function confirmCameraPresence() {
    if (livenessRef.current?.phase !== "passed") {
      setCameraError("Complete the live movement challenge before continuing.");
      return;
    }
    const video = videoRef.current;
    const purpose = cameraPurpose;
    const withdrawalId = cameraWithdrawalId;
    if (!video || !purpose) {
      setCameraError("Camera state is unavailable. Start the check again.");
      return;
    }

    setIdentityCapturing(true);
    setIdentityCaptureProgress(0);
    setCameraError(null);
    try {
      const faceEmbeddings = await captureFaceEmbeddings(video, (captured) => {
        setIdentityCaptureProgress(captured);
      });
      if (purpose === "enroll") {
        const response = await secureFetch(apiUrl("/api/face-profile"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consent: true, embeddings: faceEmbeddings }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Face enrollment failed (${response.status})`);
        closeCamera();
        setNotice(body.notice);
        await loadAccount(false);
        return;
      }

      if (!withdrawalId) throw new Error("No withdrawal request is selected");
      closeCamera();
      await approveWithdrawal(withdrawalId, faceEmbeddings);
    } catch (caught) {
      setIdentityCapturing(false);
      setCameraError(caught instanceof Error ? caught.message : "Face identity check failed");
    }
  }

  async function submitWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await secureFetch(apiUrl("/api/withdrawals"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amountVnd: Number(form.amountVnd) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      setNotice(body.notice);
      await loadAccount();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the withdrawal draft");
    } finally {
      setSubmitting(false);
    }
  }

  const fullName = [getValueFromToken("given_name"), getValueFromToken("family_name")]
    .filter(Boolean)
    .join(" ");
  const displayName = fullName || getValueFromToken("preferred_username") || "Joint owner";
  const latest = data?.withdrawalRequests[0];
  const approvalWindowExpired = latest ? Date.parse(latest.expiresAt) <= Date.now() : false;
  const applicationQuorumReached = latest?.status === "application-approved";
  const faceMismatchCancelled = latest?.status === "cancelled-face-mismatch";
  const canApprove = Boolean(
    latest &&
      latest.status === "awaiting-app-approvals" &&
      !approvalWindowExpired &&
      !latest.viewer.isRequester &&
      !latest.viewer.hasApproved,
  );
  const canRunApproval = canApprove && Boolean(data?.faceProfile.enrolled);

  function approvalButtonLabel() {
    if (!latest) return "No request selected";
    if (approving === latest.id) return "Recording verified approval…";
    if (faceMismatchCancelled) return "Request cancelled: wrong Founder face";
    if (applicationQuorumReached) return "Demo withdrawal successful";
    if (approvalWindowExpired) return "Approval window expired";
    if (latest.viewer.isRequester) return "Requester cannot self-approve";
    if (latest.viewer.hasApproved) return "Your approval is recorded";
    if (!data?.faceProfile.enrolled) return "Enroll your face before approving";
    return `Approve as ${displayName}`;
  }

  return (
    <main className="bank-shell">
      <aside className="bank-sidebar">
        <a className="brand sidebar-brand" href="/"><span className="brand-mark">C</span><span>CoSign Bank</span></a>
        <nav className="side-nav"><a className="active" href="#overview">Overview</a><a href="#withdraw">Withdraw</a><a href="#owners">Co-owners</a><a href="#security">Security</a></nav>
        <div className="sidebar-proof"><span className="proof-dot" />{mode === "tidecloak" ? "Tide session active" : mode === "supabase" ? "Supabase session active" : "Simulated session"}<small>{mode === "tidecloak" ? "JWT + strict DPoP" : mode === "supabase" ? "Email/password · token verified" : "Not Tide cryptography"}</small></div>
        <button className="signout-link" onClick={logout}>Sign out</button>
      </aside>

      <section className="bank-main">
        <header className="bank-header"><div><span>Good day, {displayName}</span><h1>Your joint account</h1></div><div className="header-actions"><span className="demo-badge">Synthetic demo</span><button className="icon-button" onClick={() => void loadAccount()} aria-label="Refresh">↻</button></div></header>

        {error && <div className="alert error" role="alert">{error}</div>}
        {notice && <div className="alert warning" role="status">{notice}</div>}

        {loading && !data ? (
          <section className="panel centered-panel"><div className="loader" /><h2>Verifying your session</h2><p>{mode === "tidecloak" ? "The server checks the Tide JWT and DPoP proof before returning account data." : mode === "supabase" ? "The server verifies your Supabase access token and joint-owner role before returning account data." : "The server verifies the simulated token and joint-owner role before returning account data."}</p></section>
        ) : data ? (
          <>
            <section className="dashboard-grid" id="overview">
              <article className="balance-card">
                <div className="balance-top"><div><span>Available balance</span><strong>{money.format(data.account.availableVnd)}</strong></div><span className="account-chip">Joint · 3 owners</span></div>
                <div className="balance-bottom"><div><small>{data.account.name}</small><b>{data.account.accountNumberMasked}</b></div><div className="mini-owners">{data.account.owners.map((owner) => <span key={owner.id}>{owner.initials}</span>)}</div></div>
              </article>

              <article className="policy-card" id="security">
                <span className="card-kicker">Withdrawal policy</span><strong>2 other owners</strong><p>The requester is excluded. Two distinct Tide identities must approve within 180 seconds.</p>
                <div className="policy-status"><span />Demo completes automatically at 2/2</div>
              </article>
            </section>

            <section className="bank-content-grid">
              <form className="panel withdraw-panel" id="withdraw" onSubmit={submitWithdrawal}>
                <div className="panel-title"><div><span className="card-kicker">Secure request</span><h2>Request a withdrawal</h2></div><span className="step-badge">Step 1 of 3</span></div>
                <label className="bank-field amount-field"><span>Amount</span><div><b>₫</b><input inputMode="numeric" value={form.amountVnd} onChange={(event) => setForm({ ...form, amountVnd: event.target.value.replace(/\D/g, "") })} required /></div><small>Maximum protected amount: ₫100,000,000</small></label>
                <div className="field-row"><label className="bank-field"><span>Recipient</span><input value={form.recipientName} maxLength={80} onChange={(event) => setForm({ ...form, recipientName: event.target.value })} required /></label><label className="bank-field"><span>Bank</span><input value={form.recipientBank} maxLength={80} onChange={(event) => setForm({ ...form, recipientBank: event.target.value })} required /></label></div>
                <div className="field-row"><label className="bank-field"><span>Account last 4 digits</span><input inputMode="numeric" pattern="[0-9]{4}" value={form.accountLast4} onChange={(event) => setForm({ ...form, accountLast4: event.target.value.replace(/\D/g, "").slice(0, 4) })} required /></label><label className="bank-field"><span>Purpose</span><input value={form.reason} maxLength={160} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label></div>
                <div className="request-warning"><span>!</span><p>{mode === "tidecloak" ? "Tide verifies each identity and role." : "The server verifies each identity and role."} At 2/2, this prototype automatically completes a synthetic withdrawal; no real funds move.</p></div>
                <button className="button dark full" disabled={submitting}>{submitting ? "Sharing secure request…" : "Request co-owner approval"}<span>→</span></button>
              </form>

              <aside className="panel approval-panel">
                <div className="panel-title"><div><span className="card-kicker">Approval room</span><h2>{latest ? latest.id : "No active request"}</h2></div>{latest && <span className="amount-tag">{money.format(latest.amountVnd)}</span>}</div>
                {latest ? (
                  <>
                    <div className="request-summary"><span>To</span><strong>{latest.recipientName}</strong><small>{latest.recipientBank} · •••• {latest.accountLast4}</small></div>
                    {applicationQuorumReached && <div className="approval-success"><span>✓</span><div><strong>Demo withdrawal successful</strong><p>Two independent co-owners approved this synthetic withdrawal. No real funds were moved.</p></div></div>}
                    {faceMismatchCancelled && <div className="approval-cancelled" role="alert"><span>!</span><div><strong>Withdrawal request cancelled</strong><p>This is not the enrolled Founder. No approval was recorded, and this request cannot continue.</p></div></div>}
                    <ol className="approval-timeline">
                      <li className="done"><span>✓</span><div><b>Identity verified</b><small>Requester came from the server-verified Tide token.</small></div></li>
                      <li className={faceMismatchCancelled ? "cancelled" : applicationQuorumReached ? "done" : "pending"}><span>{faceMismatchCancelled ? "!" : applicationQuorumReached ? "✓" : latest.approvals.length}</span><div><b>Co-owner approvals · {latest.approvals.length}/2</b><small>{faceMismatchCancelled ? "Wrong Founder face detected by the server-side profile comparison." : "Each approval requires liveness, a server-side face match and a verified Tide identity."}</small></div></li>
                      <li className={faceMismatchCancelled ? "cancelled" : applicationQuorumReached ? "done" : "pending"}><span>{faceMismatchCancelled ? "×" : applicationQuorumReached ? "✓" : "3"}</span><div><b>Demo withdrawal</b><small>{faceMismatchCancelled ? "Cancelled immediately; a new request is required." : applicationQuorumReached ? "Synthetic withdrawal completed automatically." : "Completes automatically when approval reaches 2/2."}</small></div></li>
                    </ol>
                    {latest.approvals.length > 0 && <div className="approval-list">{latest.approvals.map((approval) => <span key={`${approval.displayName}-${approval.approvedAt}`}>✓ {approval.displayName}{approval.isCurrentUser ? " · You" : ""}{approval.faceMatched ? ` · Face ${Math.round((approval.faceSimilarity ?? 0) * 100)}%` : ""}</span>)}</div>}
                    <button
                      className={`button full ${canRunApproval ? "dark" : "disabled-action"}`}
                      disabled={!canRunApproval || approving === latest.id}
                      onClick={() => beginCameraCheck("approve", latest.id)}
                    >
                      {approvalButtonLabel()}
                    </button>
                    <p className="approval-boundary">Synthetic demo only. Tide authenticates the user; the local server marks completion and no real money moves.</p>
                  </>
                ) : <div className="empty-state"><span>↗</span><p>Create a withdrawal draft to start the auditable flow.</p></div>}
              </aside>
            </section>

            <section className="panel owners-panel" id="owners">
              <div className="panel-title"><div><span className="card-kicker">Account governance</span><h2>Three equal co-owners</h2></div><span className="tiny-note">Minimum setup proving one person is insufficient</span></div>
              <div className="owner-grid">{data.account.owners.map((owner, index) => <article key={owner.id}><span className={`avatar avatar-${index + 1}`}>{owner.initials}</span><div><strong>{owner.name}</strong><p>{owner.device}</p></div><em>{owner.sharePercent}% share</em></article>)}</div>
              <div className="biometric-note face-enrollment">
                <div>
                  <span>Face identity profile</span>
                  <strong>{data.faceProfile.enrolled ? `Enrolled for ${displayName}` : "Enrollment required"}</strong>
                  <p>Three numeric face embeddings are stored locally on the demo server and tied to your verified Tide subject. Images and video are not saved.</p>
                </div>
                <button className="button secondary" onClick={() => beginCameraCheck("enroll")}>{data.faceProfile.enrolled ? "Re-enroll my face" : "Enroll my face"}</button>
              </div>
            </section>
          </>
        ) : null}
      </section>
      {completionOpen && latest?.status === "application-approved" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Demo withdrawal successful">
          <section className="modal-card completion-modal">
            <span className="completion-check">✓</span>
            <span className="card-kicker">Synthetic demo complete</span>
            <h2>Demo withdrawal successful</h2>
            <strong>{money.format(latest.amountVnd)}</strong>
            <p>Approved by two independent co-owners for {latest.recipientName}.</p>
            <small>No real bank account was charged and no real funds were transferred.</small>
            <button className="button dark full" onClick={() => setCompletionOpen(false)}>Done</button>
          </section>
        </div>
      )}
      {cameraOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Live movement check">
          <section className="modal-card camera-modal">
            <div className="camera-heading"><div><span className="card-kicker">{cameraPurpose === "enroll" ? "Biometric enrollment" : "Approval identity check"}</span><h2>{cameraPurpose === "enroll" ? "Enroll your face" : "Verify your face"}</h2></div><button className="camera-close" onClick={closeCamera} aria-label="Close camera">×</button></div>
            <div className={`camera-frame ${liveness?.phase === "passed" ? "passed" : ""} ${liveness?.phase === "failed" ? "failed" : ""}`}>
              <video ref={videoRef} autoPlay playsInline muted />
              <div className="camera-guide">
                {liveness?.phase !== "passed" && liveness?.phase !== "failed" && <span className="scan-line" />}
                {liveness?.phase === "turn" && <span className={`challenge-arrow ${liveness.direction}`}>{liveness.direction === "left" ? "←" : "→"}</span>}
                <b>{liveness?.phase === "passed" ? "Live movement passed" : liveness?.phase === "failed" ? "Check stopped" : "Keep one face inside the frame"}</b>
              </div>
            </div>
            <div className="liveness-progress" aria-label="Liveness progress">
              <span className={liveness?.phase !== "calibrating" ? "done" : "active"}>1 · Face</span>
              <span className={liveness?.phase === "turn" || liveness?.phase === "passed" ? "done" : liveness?.phase === "blink" ? "active" : ""}>2 · Blink</span>
              <span className={liveness?.phase === "passed" ? "done" : liveness?.phase === "turn" ? "active" : ""}>3 · Turn</span>
            </div>
            <div className="camera-instruction">
              <strong>{cameraError || (identityCapturing ? `Capturing face identity samples · ${identityCaptureProgress}/3` : livenessLoading ? "Loading local face model…" : liveness?.phase === "passed" ? "Look straight at the camera, then continue" : liveness?.feedback || "Starting camera…")}</strong>
              <p>{cameraPurpose === "enroll" ? "Continuing gives consent to save three numeric face embeddings for this Tide account. No image or video is saved." : "After liveness passes, the server compares three fresh embeddings with the profile enrolled for this Tide account. A mismatch cancels approval."}</p>
            </div>
            {liveness?.phase === "failed" && <p className="camera-failure">This approval attempt was cancelled. The withdrawal remains pending for a legitimate co-owner.</p>}
            <div className="camera-actions">
              <button className="button secondary" onClick={closeCamera} disabled={identityCapturing}>Cancel</button>
              {(liveness?.phase === "failed" || cameraError) && <button className="button secondary" onClick={retryCameraCheck}>Try again</button>}
              <button className="button dark" disabled={!cameraReady || liveness?.phase !== "passed" || Boolean(cameraError) || identityCapturing} onClick={() => void confirmCameraPresence()}>{identityCapturing ? "Creating face embeddings…" : cameraPurpose === "enroll" ? "Save face to my Tide account" : "Match face and approve"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
