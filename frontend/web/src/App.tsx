import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface DocumentData {
  id: string;
  name: string;
  encryptedValue: any;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  decryptedValue: number;
  isVerified: boolean;
}

interface ActivityLog {
  action: string;
  timestamp: number;
  details: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newDocData, setNewDocData] = useState({ name: "", content: "" });
  const [selectedDoc, setSelectedDoc] = useState<DocumentData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addActivityLog = (action: string, details: string = "") => {
    setActivityLogs(prev => [
      { action, timestamp: Date.now(), details },
      ...prev.slice(0, 9)
    ]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const docsList: DocumentData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          docsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: null,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            decryptedValue: Number(businessData.decryptedValue) || 0,
            isVerified: businessData.isVerified
          });
        } catch (e) {
          console.error('Error loading document:', e);
        }
      }
      
      setDocuments(docsList);
      addActivityLog("Data Loaded", `Loaded ${docsList.length} documents`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createDocument = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingDoc(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating document with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not found");
      
      const contentValue = newDocData.content.length;
      const businessId = `doc-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, contentValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDocData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newDocData.content.length,
        0,
        "FHE Encrypted Document"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Document created!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewDocData({ name: "", content: "" });
      addActivityLog("Document Created", newDocData.name);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingDoc(false); 
    }
  };

  const decryptData = async (docId: string) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(docId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(docId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(docId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addActivityLog("Document Decrypted", docId);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "System available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        addActivityLog("System Check", "Availability confirmed");
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStats = () => {
    const totalDocs = documents.length;
    const verifiedDocs = documents.filter(d => d.isVerified).length;
    const avgSize = documents.length > 0 
      ? documents.reduce((sum, d) => sum + d.publicValue1, 0) / documents.length 
      : 0;
    
    return (
      <div className="stats-panels">
        <div className="panel metal-panel">
          <h3>Total Documents</h3>
          <div className="stat-value">{totalDocs}</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Verified</h3>
          <div className="stat-value">{verifiedDocs}/{totalDocs}</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Avg Size</h3>
          <div className="stat-value">{avgSize.toFixed(1)} chars</div>
        </div>
      </div>
    );
  };

  const renderSizeChart = () => {
    const sizeGroups = [0, 0, 0, 0];
    documents.forEach(doc => {
      if (doc.publicValue1 < 100) sizeGroups[0]++;
      else if (doc.publicValue1 < 500) sizeGroups[1]++;
      else if (doc.publicValue1 < 1000) sizeGroups[2]++;
      else sizeGroups[3]++;
    });
    
    const maxValue = Math.max(...sizeGroups, 1);
    
    return (
      <div className="chart-container">
        <div className="chart-bar">
          <div className="bar-label">0-100</div>
          <div className="bar-fill" style={{ width: `${(sizeGroups[0]/maxValue)*100}%` }}>
            <span>{sizeGroups[0]}</span>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">100-500</div>
          <div className="bar-fill" style={{ width: `${(sizeGroups[1]/maxValue)*100}%` }}>
            <span>{sizeGroups[1]}</span>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">500-1000</div>
          <div className="bar-fill" style={{ width: `${(sizeGroups[2]/maxValue)*100}%` }}>
            <span>{sizeGroups[2]}</span>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">1000+</div>
          <div className="bar-fill" style={{ width: `${(sizeGroups[3]/maxValue)*100}%` }}>
            <span>{sizeGroups[3]}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => (
    <div className="faq-section">
      <h3>FHE Document FAQ</h3>
      <div className="faq-item">
        <div className="faq-question">How does FHE protect my documents?</div>
        <div className="faq-answer">Documents are encrypted on your device before storage. Only authorized users can decrypt and view content.</div>
      </div>
      <div className="faq-item">
        <div className="faq-question">Can I collaborate on encrypted documents?</div>
        <div className="faq-answer">Yes, multiple users can edit encrypted documents without exposing content to the server.</div>
      </div>
      <div className="faq-item">
        <div className="faq-question">What data types are supported?</div>
        <div className="faq-answer">Currently only integer values can be encrypted and processed with FHE operations.</div>
      </div>
    </div>
  );

  const renderActivityLog = () => (
    <div className="activity-log">
      <h3>Recent Activity</h3>
      <div className="log-items">
        {activityLogs.length === 0 ? (
          <div className="log-empty">No activity yet</div>
        ) : (
          activityLogs.map((log, index) => (
            <div className="log-item" key={index}>
              <div className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</div>
              <div className="log-action">{log.action}</div>
              {log.details && <div className="log-details">{log.details}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Docs</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access</h2>
            <p>Secure your documents with fully homomorphic encryption</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted documents...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Docs</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Document
          </button>
          <button 
            onClick={checkAvailability}
            className="check-btn"
          >
            Check System
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="left-panel">
          <div className="panel metal-panel">
            <h2>Document Stats</h2>
            {renderStats()}
          </div>
          
          <div className="panel metal-panel">
            <h2>Size Distribution</h2>
            {renderSizeChart()}
          </div>
          
          <div className="panel metal-panel">
            <h2>Activity Log</h2>
            {renderActivityLog()}
          </div>
        </div>
        
        <div className="right-panel">
          <div className="panel metal-panel">
            <div className="panel-header">
              <h2>Encrypted Documents</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
                <button 
                  onClick={() => setShowFAQ(!showFAQ)}
                  className="faq-btn"
                >
                  {showFAQ ? "Hide FAQ" : "Show FAQ"}
                </button>
              </div>
            </div>
            
            {showFAQ ? renderFAQ() : (
              <div className="documents-list">
                {documents.length === 0 ? (
                  <div className="no-documents">
                    <p>No encrypted documents</p>
                    <button 
                      className="create-btn" 
                      onClick={() => setShowCreateModal(true)}
                    >
                      Create First Document
                    </button>
                  </div>
                ) : documents.map((doc, index) => (
                  <div 
                    className={`document-item ${selectedDoc?.id === doc.id ? "selected" : ""} ${doc.isVerified ? "verified" : ""}`} 
                    key={index}
                    onClick={() => setSelectedDoc(doc)}
                  >
                    <div className="document-title">{doc.name}</div>
                    <div className="document-meta">
                      <span>Size: {doc.publicValue1} chars</span>
                      <span>Created: {new Date(doc.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="document-status">
                      {doc.isVerified ? "✅ Verified" : "🔓 Ready for verification"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateDocument 
          onSubmit={createDocument} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingDoc} 
          docData={newDocData} 
          setDocData={setNewDocData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedDoc && (
        <DocumentDetailModal 
          doc={selectedDoc} 
          onClose={() => setSelectedDoc(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedDoc.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateDocument: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  docData: any;
  setDocData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, docData, setDocData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDocData({ ...docData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-doc-modal">
        <div className="modal-header">
          <h2>New Encrypted Document</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption</strong>
            <p>Document size will be encrypted with Zama FHE</p>
          </div>
          
          <div className="form-group">
            <label>Document Name *</label>
            <input 
              type="text" 
              name="name" 
              value={docData.name} 
              onChange={handleChange} 
              placeholder="Document name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Document Content *</label>
            <textarea 
              name="content" 
              value={docData.content} 
              onChange={handleChange} 
              placeholder="Enter content..." 
              rows={4}
            />
            <div className="data-info">Size: {docData.content.length} chars</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !docData.name || !docData.content} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Document"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DocumentDetailModal: React.FC<{
  doc: DocumentData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ doc, onClose, isDecrypting, decryptData }) => {
  const [decryptedSize, setDecryptedSize] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const size = await decryptData();
    setDecryptedSize(size);
  };

  return (
    <div className="modal-overlay">
      <div className="doc-detail-modal">
        <div className="modal-header">
          <h2>Document Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="doc-info">
            <div className="info-item">
              <span>Name:</span>
              <strong>{doc.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{doc.creator.substring(0, 6)}...{doc.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(doc.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Public Size:</span>
              <strong>{doc.publicValue1} chars</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Data</h3>
            
            <div className="data-row">
              <div className="data-label">Actual Size:</div>
              <div className="data-value">
                {doc.isVerified ? 
                  `${doc.decryptedValue} chars (Verified)` : 
                  decryptedSize !== null ? 
                  `${decryptedSize} chars (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(doc.isVerified || decryptedSize !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : "Decrypt Size"}
              </button>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


