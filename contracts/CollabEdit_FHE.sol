pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedDocumentManager is ZamaEthereumConfig {
    
    struct Document {
        string docId;
        euint32 encryptedContent;
        address owner;
        uint256 timestamp;
        bool isVerified;
        uint32 decryptedHash;
    }
    
    mapping(string => Document) public documents;
    string[] public documentIds;
    
    event DocumentCreated(string indexed docId, address indexed owner);
    event DecryptionVerified(string indexed docId, uint32 decryptedHash);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createDocument(
        string calldata docId,
        externalEuint32 encryptedContent,
        bytes calldata inputProof
    ) external {
        require(bytes(documents[docId].docId).length == 0, "Document already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedContent, inputProof)), "Invalid encrypted content");
        
        documents[docId] = Document({
            docId: docId,
            encryptedContent: FHE.fromExternal(encryptedContent, inputProof),
            owner: msg.sender,
            timestamp: block.timestamp,
            isVerified: false,
            decryptedHash: 0
        });
        
        FHE.allowThis(documents[docId].encryptedContent);
        FHE.makePubliclyDecryptable(documents[docId].encryptedContent);
        
        documentIds.push(docId);
        emit DocumentCreated(docId, msg.sender);
    }
    
    function verifyDocumentDecryption(
        string calldata docId,
        bytes memory abiEncodedClearHash,
        bytes memory decryptionProof
    ) external {
        require(bytes(documents[docId].docId).length > 0, "Document does not exist");
        require(!documents[docId].isVerified, "Document already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(documents[docId].encryptedContent);
        
        FHE.checkSignatures(cts, abiEncodedClearHash, decryptionProof);
        
        uint32 decodedHash = abi.decode(abiEncodedClearHash, (uint32));
        documents[docId].decryptedHash = decodedHash;
        documents[docId].isVerified = true;
        
        emit DecryptionVerified(docId, decodedHash);
    }
    
    function getDocumentContent(string calldata docId) external view returns (euint32) {
        require(bytes(documents[docId].docId).length > 0, "Document does not exist");
        return documents[docId].encryptedContent;
    }
    
    function getDocumentDetails(string calldata docId) external view returns (
        address owner,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedHash
    ) {
        require(bytes(documents[docId].docId).length > 0, "Document does not exist");
        Document storage doc = documents[docId];
        
        return (
            doc.owner,
            doc.timestamp,
            doc.isVerified,
            doc.decryptedHash
        );
    }
    
    function getAllDocumentIds() external view returns (string[] memory) {
        return documentIds;
    }
    
    function updateDocumentContent(
        string calldata docId,
        externalEuint32 newEncryptedContent,
        bytes calldata inputProof
    ) external {
        require(bytes(documents[docId].docId).length > 0, "Document does not exist");
        require(msg.sender == documents[docId].owner, "Only owner can update");
        require(FHE.isInitialized(FHE.fromExternal(newEncryptedContent, inputProof)), "Invalid encrypted content");
        
        documents[docId].encryptedContent = FHE.fromExternal(newEncryptedContent, inputProof);
        documents[docId].timestamp = block.timestamp;
        documents[docId].isVerified = false;
        
        FHE.allowThis(documents[docId].encryptedContent);
        FHE.makePubliclyDecryptable(documents[docId].encryptedContent);
    }
    
    function transferOwnership(string calldata docId, address newOwner) external {
        require(bytes(documents[docId].docId).length > 0, "Document does not exist");
        require(msg.sender == documents[docId].owner, "Only owner can transfer");
        require(newOwner != address(0), "Invalid new owner");
        
        documents[docId].owner = newOwner;
    }
    
    function isDocumentVerified(string calldata docId) external view returns (bool) {
        require(bytes(documents[docId].docId).length > 0, "Document does not exist");
        return documents[docId].isVerified;
    }
    
    function getDocumentCount() external view returns (uint256) {
        return documentIds.length;
    }
    
    function isServiceAvailable() public pure returns (bool) {
        return true;
    }
}


